// enhanced-ai-helper.js
export async function getAIResponse(messages) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": ``
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: messages,
        temperature: 0.7,
        max_tokens: 2000
      })
    });  

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "⚠️ No reply from AI.";
  } catch (error) {
    console.error('Error getting AI response:', error);
    return "⚠️ Sorry, I'm having trouble connecting to the AI service. Please try again.";
  }
}

/**
 * Enhanced embedding service that can use different providers
 */
export class EmbeddingService {
  constructor(config = {}) {
    this.openaiApiKey = config.openaiApiKey || 'your-openai-api-key-here';
    this.provider = config.provider || 'openai'; // 'openai' or 'local'
    this.model = config.model || 'text-embedding-ada-002';
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
  }

  /**
   * Generate embeddings using OpenAI
   */
  async generateOpenAIEmbedding(text) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openaiApiKey}`
          },
          body: JSON.stringify({
            input: text.substring(0, 8000), // OpenAI token limit
            model: this.model
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return data.data[0].embedding;
      } catch (error) {
        console.warn(`Embedding attempt ${attempt} failed:`, error);
        
        if (attempt === this.maxRetries) {
          throw error;
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, attempt - 1)));
      }
    }
  }

  /**
   * Fallback local embedding using TF-IDF-like approach
   * This is a simple fallback when OpenAI is not available
   */
  generateLocalEmbedding(text) {
    // Simple TF-IDF-like embedding as fallback
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const wordFreq = {};
    
    // Count word frequencies
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    
    // Create a simple embedding vector (this is very basic)
    const vocab = Object.keys(wordFreq).sort();
    const embedding = new Array(300).fill(0); // 300-dimensional vector
    
    vocab.forEach((word, index) => {
      if (index < 300) {
        embedding[index] = wordFreq[word] / words.length;
      }
    });
    
    // Add some hash-based features for better representation
    for (let i = 0; i < text.length && i < 100; i++) {
      const charCode = text.charCodeAt(i);
      const idx = charCode % 200 + 100; // Use positions 100-299
      if (idx < 300) {
        embedding[idx] += 0.01;
      }
    }
    
    return embedding;
  }

  /**
   * Main method to generate embeddings with fallback
   */
  async generateEmbedding(text) {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    try {
      if (this.provider === 'openai' && this.openaiApiKey !== 'your-openai-api-key-here') {
        return await this.generateOpenAIEmbedding(text);
      } else {
        console.warn('Using local embedding fallback');
        return this.generateLocalEmbedding(text);
      }
    } catch (error) {
      console.warn('OpenAI embedding failed, falling back to local:', error);
      return this.generateLocalEmbedding(text);
    }
  }
}

/**
 * Semantic Search Manager
 */
export class SemanticSearchManager {
  constructor(embeddingService) {
    this.embeddingService = embeddingService;
    this.documentCache = new Map();
    this.embeddingCache = new Map();
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Split text into meaningful chunks
   */
  createTextChunks(text, filename, chunkSize = 1000, overlap = 200) {
    const chunks = [];
    
    // Split by paragraphs first
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    let currentChunk = '';
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length <= chunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      } else {
        if (currentChunk) {
          chunks.push({
            id: `${filename}_chunk_${chunkIndex}`,
            content: currentChunk,
            filename: filename,
            chunkIndex: chunkIndex,
            wordCount: currentChunk.split(/\s+/).length
          });
          chunkIndex++;
        }
        
        // Handle large paragraphs
        if (paragraph.length > chunkSize) {
          const sentences = paragraph.split(/[.!?]+/).filter(s => s.trim().length > 0);
          let sentenceChunk = '';
          
          for (const sentence of sentences) {
            if (sentenceChunk.length + sentence.length <= chunkSize) {
              sentenceChunk += (sentenceChunk ? '. ' : '') + sentence.trim();
            } else {
              if (sentenceChunk) {
                chunks.push({
                  id: `${filename}_chunk_${chunkIndex}`,
                  content: sentenceChunk + '.',
                  filename: filename,
                  chunkIndex: chunkIndex,
                  wordCount: sentenceChunk.split(/\s+/).length
                });
                chunkIndex++;
              }
              sentenceChunk = sentence.trim();
            }
          }
          
          if (sentenceChunk) {
            currentChunk = sentenceChunk + '.';
          } else {
            currentChunk = '';
          }
        } else {
          currentChunk = paragraph;
        }
      }
    }

    // Add remaining content
    if (currentChunk) {
      chunks.push({
        id: `${filename}_chunk_${chunkIndex}`,
        content: currentChunk,
        filename: filename,
        chunkIndex: chunkIndex,
        wordCount: currentChunk.split(/\s+/).length
      });
    }

    return chunks;
  }

  /**
   * Process documents and generate embeddings
   */
  async processDocuments(filesContentMap, progressCallback = null) {
    const allChunks = [];
    const totalFiles = Object.keys(filesContentMap).length;
    let processedFiles = 0;

    console.log(`🔄 Processing ${totalFiles} documents for semantic search...`);

    for (const [filename, content] of Object.entries(filesContentMap)) {
      if (!content || content.trim().length === 0) {
        processedFiles++;
        continue;
      }

      try {
        // Check cache first
        const cacheKey = `${filename}_${content.length}_${content.substring(0, 100)}`;
        if (this.embeddingCache.has(cacheKey)) {
          const cachedChunks = this.embeddingCache.get(cacheKey);
          allChunks.push(...cachedChunks);
          processedFiles++;
          
          if (progressCallback) {
            progressCallback(processedFiles, totalFiles, filename, 'cached');
          }
          continue;
        }

        console.log(`📄 Processing ${filename}...`);
        
        // Create chunks
        const chunks = this.createTextChunks(content, filename);
        const chunksWithEmbeddings = [];

        // Generate embeddings for each chunk
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          
          try {
            const embedding = await this.embeddingService.generateEmbedding(chunk.content);
            chunksWithEmbeddings.push({
              ...chunk,
              embedding: embedding
            });
            
            console.log(`  ✅ Chunk ${i + 1}/${chunks.length} processed`);
            
            // Small delay to avoid rate limits
            if (i < chunks.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            
          } catch (error) {
            console.warn(`Failed to generate embedding for chunk ${chunk.id}:`, error);
            // Continue without this chunk
          }
        }

        // Cache the results
        this.embeddingCache.set(cacheKey, chunksWithEmbeddings);
        allChunks.push(...chunksWithEmbeddings);
        
        processedFiles++;
        console.log(`✅ ${filename}: ${chunksWithEmbeddings.length} chunks processed`);
        
        if (progressCallback) {
          progressCallback(processedFiles, totalFiles, filename, 'completed');
        }
        
      } catch (error) {
        console.error(`❌ Error processing ${filename}:`, error);
        processedFiles++;
        
        if (progressCallback) {
          progressCallback(processedFiles, totalFiles, filename, 'error');
        }
      }
    }

    console.log(`🎯 Total chunks with embeddings: ${allChunks.length}`);
    return allChunks;
  }

  /**
   * Perform semantic search
   */
  async search(query, documentChunks, options = {}) {
    const {
      topK = 5,
      similarityThreshold = 0.7,
      includeContent = true,
      maxContentLength = 500
    } = options;

    try {
      console.log(`🔍 Semantic search for: "${query}"`);
      
      // Generate query embedding
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      
      // Calculate similarities
      const results = documentChunks.map(chunk => {
        const similarity = this.cosineSimilarity(queryEmbedding, chunk.embedding);
        
        return {
          id: chunk.id,
          filename: chunk.filename,
          chunkIndex: chunk.chunkIndex,
          similarity: similarity,
          wordCount: chunk.wordCount,
          content: includeContent ? (
            chunk.content.length > maxContentLength 
              ? chunk.content.substring(0, maxContentLength) + '...'
              : chunk.content
          ) : null
        };
      });

      // Filter and sort results
      const filteredResults = results
        .filter(result => result.similarity >= similarityThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);

      console.log(`✅ Found ${filteredResults.length} relevant chunks (threshold: ${similarityThreshold})`);
      
      return filteredResults;
      
    } catch (error) {
      console.error('Semantic search error:', error);
      return [];
    }
  }

  /**
   * Get search suggestions based on document content
   */
  async getSuggestions(documentChunks, count = 5) {
    // Extract key phrases from documents for suggestions
    const keyPhrases = new Set();
    
    documentChunks.forEach(chunk => {
      // Simple phrase extraction (you could enhance this)
      const phrases = chunk.content.match(/[A-Z][a-z]+ [a-z]+/g) || [];
      phrases.slice(0, 3).forEach(phrase => keyPhrases.add(phrase));
    });
    
    return Array.from(keyPhrases).slice(0, count);
  }

  /**
   * Clear caches
   */
  clearCache() {
    this.documentCache.clear();
    this.embeddingCache.clear();
    console.log('🗑️ Semantic search caches cleared');
  }
}

/**
 * Initialize semantic search system
 */
export function initializeSemanticSearch(config = {}) {
  const embeddingService = new EmbeddingService({
    openaiApiKey: config.openaiApiKey || 'your-openai-api-key-here',
    provider: config.provider || 'openai',
    model: config.model || 'text-embedding-ada-002'
  });
  
  const searchManager = new SemanticSearchManager(embeddingService);
  
  return {
    embeddingService,
    searchManager,
    
    // Convenience methods
    async processFiles(filesContentMap, progressCallback) {
      return await searchManager.processDocuments(filesContentMap, progressCallback);
    },
    
    async search(query, documentChunks, options) {
      return await searchManager.search(query, documentChunks, options);
    },
    
    async getSuggestions(documentChunks, count) {
      return await searchManager.getSuggestions(documentChunks, count);
    },
    
    clearCache() {
      searchManager.clearCache();
    }
  };
}