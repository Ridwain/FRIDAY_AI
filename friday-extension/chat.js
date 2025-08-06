import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp, query, orderBy, getDocs, getDoc, doc, setDoc, updateDoc } from './firebase/firebase-firestore.js';

// SEMANTIC SEARCH CONFIGURATION
const EMBEDDING_CONFIG = {
  OPENAI_API_KEY: 'your-openai-api-key-here', // Replace with your OpenAI API key
  EMBEDDING_MODEL: 'text-embedding-ada-002',
  EMBEDDING_DIMENSIONS: 1536,
  SIMILARITY_THRESHOLD: 0.7,
  MAX_DOCUMENTS_FOR_CONTEXT: 5,
  CHUNK_SIZE: 1000, // Characters per chunk for large documents
  CHUNK_OVERLAP: 200 // Overlap between chunks
};

// In-memory storage for embeddings cache
const embeddingsCache = new Map();
const documentChunksCache = new Map();

function normalizeFilename(name) {
  return name.trim().toLowerCase();
}

document.addEventListener("DOMContentLoaded", () => {
  // Notify background script that extension page is available
  chrome.runtime.sendMessage({ type: "EXTENSION_PAGE_CONNECTED" });

  // Add message listener for transcript processing
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle new single-document transcript operations
    if (message.type === "INIT_TRANSCRIPT_DOC") {
      initializeTranscriptDocument(message.uid, message.meetingId, message.docId, message.startTime, message.status);
      sendResponse({success: true});
    } else if (message.type === "UPDATE_TRANSCRIPT_DOC") {
      updateTranscriptDocument(message.uid, message.meetingId, message.docId, message.transcript, message.lastUpdated, message.status);
      sendResponse({success: true});
    } else if (message.type === "FINALIZE_TRANSCRIPT_DOC") {
      finalizeTranscriptDocument(message.uid, message.meetingId, message.docId, message.transcript, message.endTime, message.wordCount, message.status);
      sendResponse({success: true});
    }
    // Handle legacy transcript operations for backward compatibility
    else if (message.type === "PROCESS_TRANSCRIPT_QUEUE") {
      // Process queued transcripts (legacy)
      processQueuedTranscripts(message.queue);
      sendResponse({success: true});
    } else if (message.type === "SAVE_TRANSCRIPT_REQUEST") {
      // Handle direct transcript saving request (legacy)
      saveTranscriptToFirebase(message.uid, message.meetingId, message.transcript);
      sendResponse({success: true});
    }
    // Handle other message types
    else if (message.type === "SPEECH_RESULT") {
      if (chatInput) {
        chatInput.value = message.transcript;
        chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      }
    } else if (message.type === "MIC_STATUS") {
      if (micBtn) {
        if (message.status === "listening") {
          isMicActive = true;
          micBtn.textContent = '●';
          micBtn.style.color = 'red';
          micBtn.title = 'Listening... Click to stop';
        } else {
          isMicActive = false;
          micBtn.textContent = '🎤';
          micBtn.style.color = '';
          micBtn.title = 'Speak your question';
        }
      }
    } else if (message.type === "MIC_ERROR") {
      isMicActive = false;
      if (micBtn) {
        micBtn.textContent = '🎤';
        micBtn.style.color = '';
        micBtn.title = 'Speak your question';
      }
      alert("Voice input error: " + message.error);
    } else if (message.type === "MIC_UNSUPPORTED") {
      if (micBtn) {
        micBtn.disabled = true;
        micBtn.title = "Speech Recognition not supported in active tab.";
      }
    }
  });

  // Function to initialize a new transcript document
  async function initializeTranscriptDocument(uid, meetingId, docId, startTime, status) {
    try {
      const transcriptDocRef = doc(db, "users", uid, "meetings", meetingId, "transcripts", docId);
      await setDoc(transcriptDocRef, {
        transcript: "",
        startTime: startTime,
        lastUpdated: startTime,
        status: status,
        wordCount: 0,
        createdAt: serverTimestamp()
      });
      console.log(`Initialized transcript document: ${docId}`);
    } catch (error) {
      console.error("Error initializing transcript document:", error);
      // Fallback to chrome.storage
      await storeTranscriptInStorage(uid, meetingId, docId, {
        transcript: "",
        startTime: startTime,
        status: status
      });
    }
  }

  // Function to update transcript document in real-time
  async function updateTranscriptDocument(uid, meetingId, docId, transcript, lastUpdated, status) {
    try {
      const transcriptDocRef = doc(db, "users", uid, "meetings", meetingId, "transcripts", docId);
      
      // Use setDoc with merge: true to ensure document exists
      await setDoc(transcriptDocRef, {
        transcript: transcript,
        lastUpdated: lastUpdated,
        status: status,
        wordCount: transcript.trim().split(/\s+/).filter(word => word.length > 0).length
      }, { merge: true });
      
      console.log(`Updated transcript document: ${docId} (${transcript.length} chars)`);
    } catch (error) {
      console.error("Error updating transcript document:", error);
      // Fallback to chrome.storage
      await storeTranscriptInStorage(uid, meetingId, docId, {
        transcript: transcript,
        lastUpdated: lastUpdated,
        status: status
      });
    }
  }

  // Function to finalize transcript document
  async function finalizeTranscriptDocument(uid, meetingId, docId, transcript, endTime, wordCount, status) {
    try {
      const transcriptDocRef = doc(db, "users", uid, "meetings", meetingId, "transcripts", docId);
      
      // Use setDoc with merge: true instead of updateDoc to ensure document exists
      await setDoc(transcriptDocRef, {
        transcript: transcript,
        endTime: endTime,
        status: status,
        wordCount: wordCount,
        finalizedAt: serverTimestamp()
      }, { merge: true });
      
      console.log(`Finalized transcript document: ${docId} (${wordCount} words)`);
    } catch (error) {
      console.error("Error finalizing transcript document:", error);
      // Fallback to chrome.storage
      await storeTranscriptInStorage(uid, meetingId, docId, {
        transcript: transcript,
        endTime: endTime,
        status: status,
        wordCount: wordCount
      });
    }
  }

  // Function to process queued transcripts (legacy support)
  async function processQueuedTranscripts(queue) {
    for (const item of queue) {
      try {
        const transcriptDocRef = doc(collection(db, "users", item.uid, "meetings", item.meetingId, "transcripts"));
        await setDoc(transcriptDocRef, { 
          content: item.transcript, 
          timestamp: serverTimestamp() 
        }, { merge: true });
        console.log(`Processed queued transcript for meeting ${item.meetingId}`);
      } catch (error) {
        console.error("Error processing queued transcript:", error);
      }
    }
    
    // Also process any stored transcripts
    await processStoredTranscripts();
  }

  // Function to process transcripts stored in chrome.storage
  async function processStoredTranscripts() {
    try {
      const allData = await chrome.storage.local.get();
      const transcriptKeys = Object.keys(allData).filter(key => key.startsWith('transcript_'));
      
      if (transcriptKeys.length > 0) {
        for (const key of transcriptKeys) {
          const parts = key.split('_');
          if (parts.length >= 4) {
            // New format: transcript_uid_meetingId_docId
            const [, uid, meetingId, docId] = parts;
            const data = allData[key];
            
            if (data && typeof data === 'object') {
              const transcriptDocRef = doc(db, "users", uid, "meetings", meetingId, "transcripts", docId);
              await setDoc(transcriptDocRef, {
                transcript: data.transcript || "",
                startTime: data.startTime,
                endTime: data.endTime,
                lastUpdated: data.lastUpdated,
                status: data.status || 'completed',
                wordCount: data.wordCount || 0,
                createdAt: serverTimestamp()
              });
              
              // Remove from storage after successful save
              await chrome.storage.local.remove(key);
              console.log(`Processed stored transcript: ${docId}`);
            }
          } else if (parts.length === 3) {
            // Legacy format: transcript_uid_meetingId
            const [, uid, meetingId] = parts;
            const transcript = allData[key];
            
            if (transcript && transcript.trim()) {
              const transcriptDocRef = doc(collection(db, "users", uid, "meetings", meetingId, "transcripts"));
              await setDoc(transcriptDocRef, { 
                content: transcript, 
                timestamp: serverTimestamp() 
              });
              
              // Remove from storage after successful save
              await chrome.storage.local.remove(key);
              console.log(`Processed legacy stored transcript for meeting ${meetingId}`);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error processing stored transcripts:", error);
    }
  }

  // Fallback storage function
  async function storeTranscriptInStorage(uid, meetingId, docId, data) {
    try {
      const storageKey = `transcript_${uid}_${meetingId}_${docId}`;
      await chrome.storage.local.set({
        [storageKey]: data
      });
      console.log("Transcript stored in chrome.storage as backup:", storageKey);
    } catch (error) {
      console.error("Failed to store transcript in storage:", error);
    }
  }

  // Function to save transcript to Firebase (for direct requests - legacy)
  async function saveTranscriptToFirebase(uid, meetingId, transcript) {
    try {
      const transcriptDocRef = doc(collection(db, "users", uid, "meetings", meetingId, "transcripts"));
      await setDoc(transcriptDocRef, { 
        content: transcript, 
        timestamp: serverTimestamp() 
      }, { merge: true });
      console.log("Transcript saved successfully via chat window");
    } catch (err) {
      console.error("Failed to save transcript:", err);
    }
  }

  // Function to load transcript (updated to handle new format)
  async function loadTranscript(uid, meetingId) {
    try {
      const transcriptsRef = collection(db, "users", uid, "meetings", meetingId, "transcripts");
      const snapshot = await getDocs(transcriptsRef);
      let transcriptContent = "";
      
      snapshot.forEach(doc => {
        const data = doc.data();
        // Handle both new format (transcript field) and legacy format (content field)
        if (data.transcript) {
          transcriptContent += data.transcript + "\n";
        } else if (data.content) {
          transcriptContent += data.content + "\n";
        }
      });
      
      return transcriptContent.trim();
    } catch (error) {
      console.error("Error loading transcript:", error);
      return "Failed to load meeting transcript.";
    }
  }

  // SEMANTIC SEARCH IMPLEMENTATION

  /**
   * Generate embeddings using OpenAI API
   * @param {string} text - Text to generate embeddings for
   * @returns {Promise<number[]>} - Array of embedding values
   */
  async function generateEmbedding(text) {
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${EMBEDDING_CONFIG.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          input: text.substring(0, 8000), // OpenAI has token limits
          model: EMBEDDING_CONFIG.EMBEDDING_MODEL
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {number[]} a - First vector
   * @param {number[]} b - Second vector
   * @returns {number} - Cosine similarity score (0-1)
   */
  function cosineSimilarity(a, b) {
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
   * Split document into chunks for better embedding performance
   * @param {string} content - Document content
   * @param {string} filename - Document filename
   * @returns {Array} - Array of document chunks
   */
  function createDocumentChunks(content, filename) {
    const chunks = [];
    const chunkSize = EMBEDDING_CONFIG.CHUNK_SIZE;
    const overlap = EMBEDDING_CONFIG.CHUNK_OVERLAP;

    // Split by paragraphs first, then by sentences if needed
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
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
            startPos: Math.max(0, currentChunk.length - overlap)
          });
          chunkIndex++;
        }
        
        // Start new chunk, potentially with overlap
        if (paragraph.length > chunkSize) {
          // Split large paragraph into smaller chunks
          for (let i = 0; i < paragraph.length; i += chunkSize - overlap) {
            const chunk = paragraph.substring(i, i + chunkSize);
            chunks.push({
              id: `${filename}_chunk_${chunkIndex}`,
              content: chunk,
              filename: filename,
              chunkIndex: chunkIndex,
              startPos: i
            });
            chunkIndex++;
          }
          currentChunk = '';
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
        startPos: 0
      });
    }

    return chunks;
  }

  /**
   * Process and generate embeddings for all documents
   * @param {Object} filesContentMap - Map of filename to content
   * @returns {Promise<Array>} - Array of document chunks with embeddings
   */
  async function processDocumentsForEmbeddings(filesContentMap) {
    console.log('🧠 Processing documents for semantic search...');
    const allChunks = [];

    for (const [filename, content] of Object.entries(filesContentMap)) {
      if (!content || content.trim().length === 0) continue;

      try {
        // Check if we already have embeddings for this document
        const cacheKey = `${filename}_${content.length}`;
        if (embeddingsCache.has(cacheKey)) {
          allChunks.push(...embeddingsCache.get(cacheKey));
          continue;
        }

        console.log(`🔄 Processing ${filename}...`);
        const chunks = createDocumentChunks(content, filename);
        const chunksWithEmbeddings = [];

        for (const chunk of chunks) {
          try {
            const embedding = await generateEmbedding(chunk.content);
            chunksWithEmbeddings.push({
              ...chunk,
              embedding: embedding
            });
            
            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.warn(`Failed to generate embedding for chunk ${chunk.id}:`, error);
          }
        }

        // Cache the results
        embeddingsCache.set(cacheKey, chunksWithEmbeddings);
        documentChunksCache.set(filename, chunksWithEmbeddings);
        allChunks.push(...chunksWithEmbeddings);

        console.log(`✅ Processed ${filename}: ${chunksWithEmbeddings.length} chunks`);
      } catch (error) {
        console.error(`Error processing ${filename}:`, error);
      }
    }

    console.log(`🎯 Total processed chunks: ${allChunks.length}`);
    return allChunks;
  }

  /**
   * Perform semantic search across documents
   * @param {string} query - User query
   * @param {Array} documentChunks - Array of document chunks with embeddings
   * @returns {Promise<Array>} - Ranked search results
   */
  async function performSemanticSearch(query, documentChunks) {
    try {
      console.log(`🔍 Performing semantic search for: "${query}"`);
      
      // Generate embedding for the query
      const queryEmbedding = await generateEmbedding(query);
      
      // Calculate similarity with all document chunks
      const similarities = documentChunks.map(chunk => {
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        return {
          ...chunk,
          similarity: similarity
        };
      });

      // Sort by similarity and filter by threshold
      const rankedResults = similarities
        .filter(result => result.similarity >= EMBEDDING_CONFIG.SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, EMBEDDING_CONFIG.MAX_DOCUMENTS_FOR_CONTEXT);

      console.log(`✅ Found ${rankedResults.length} relevant chunks`);
      return rankedResults;
      
    } catch (error) {
      console.error('Error in semantic search:', error);
      return [];
    }
  }

  /**
   * Enhanced search that combines keyword and semantic search
   * @param {string} query - User query
   * @param {Object} filesContentMap - Map of files to content
   * @param {Array} transcriptResults - Results from transcript search
   * @returns {Promise<Object>} - Combined search results
   */
  async function performEnhancedSearch(query, filesContentMap, transcriptResults = []) {
    try {
      // Step 1: Process documents and generate embeddings if not already done
      const documentChunks = await processDocumentsForEmbeddings(filesContentMap);
      
      // Step 2: Perform semantic search
      const semanticResults = await performSemanticSearch(query, documentChunks);
      
      // Step 3: Combine with existing keyword search results
      const keywordResults = await searchFilesContent(filesContentMap, query);
      
      // Step 4: Merge and deduplicate results
      const combinedResults = mergeSearchResults(semanticResults, keywordResults, transcriptResults);
      
      return {
        semanticResults: semanticResults,
        keywordResults: keywordResults,
        transcriptResults: transcriptResults,
        combinedResults: combinedResults,
        totalRelevantChunks: semanticResults.length
      };
      
    } catch (error) {
      console.error('Error in enhanced search:', error);
      return {
        semanticResults: [],
        keywordResults: keywordResults || [],
        transcriptResults: transcriptResults || [],
        combinedResults: [],
        totalRelevantChunks: 0
      };
    }
  }

  /**
   * Merge different types of search results
   * @param {Array} semanticResults - Semantic search results
   * @param {Array} keywordResults - Keyword search results
   * @param {Array} transcriptResults - Transcript search results
   * @returns {Array} - Merged and ranked results
   */
  function mergeSearchResults(semanticResults, keywordResults, transcriptResults) {
    const resultMap = new Map();
    
    // Add semantic results (highest priority for file content)
    semanticResults.forEach((result, index) => {
      const key = `${result.filename}_${result.chunkIndex}`;
      resultMap.set(key, {
        ...result,
        type: 'semantic',
        finalScore: result.similarity * 10 + (semanticResults.length - index), // Boost semantic results
        contexts: [{
          text: result.content.substring(0, 300) + (result.content.length > 300 ? '...' : ''),
          relevance: result.similarity,
          type: 'semantic_match'
        }]
      });
    });
    
    // Add keyword results with lower priority
    keywordResults.forEach((result, index) => {
      const key = `${result.filename}_keyword`;
      if (!resultMap.has(key)) {
        resultMap.set(key, {
          ...result,
          type: 'keyword',
          finalScore: result.score + (keywordResults.length - index),
          similarity: result.score / 10 // Normalize to 0-1 range
        });
      } else {
        // Boost score if found in both semantic and keyword search
        const existing = resultMap.get(key);
        existing.finalScore += result.score;
        existing.type = 'combined';
      }
    });
    
    // Add transcript results
    transcriptResults.forEach((result, index) => {
      const key = `transcript_${result.docId}`;
      resultMap.set(key, {
        ...result,
        type: 'transcript',
        finalScore: result.score + (transcriptResults.length - index),
        similarity: result.score / 10
      });
    });
    
    // Sort by final score and return top results
    return Array.from(resultMap.values())
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, EMBEDDING_CONFIG.MAX_DOCUMENTS_FOR_CONTEXT);
  }

  /**
   * Build context for AI from search results
   * @param {Array} searchResults - Combined search results
   * @returns {string} - Formatted context string
   */
  function buildEnhancedContext(searchResults) {
    if (!searchResults || searchResults.length === 0) {
      return "";
    }

    let context = "RELEVANT DOCUMENTS AND CONTEXT:\n\n";
    
    searchResults.forEach((result, index) => {
      context += `Document ${index + 1}: ${result.filename || 'Meeting Transcript'}\n`;
      context += `Relevance Score: ${(result.similarity || result.score / 10).toFixed(3)}\n`;
      context += `Type: ${result.type}\n`;
      
      if (result.contexts && result.contexts.length > 0) {
        context += "Content:\n";
        result.contexts.forEach(ctx => {
          context += `"${ctx.text}"\n`;
        });
      } else if (result.content) {
        const preview = result.content.length > 500 
          ? result.content.substring(0, 500) + "..."
          : result.content;
        context += `Content: "${preview}"\n`;
      }
      
      context += "\n---\n\n";
    });

    return context;
  }

  // ENHANCED AI FUNCTIONS START HERE

  // Enhanced function to search through all transcript documents with semantic search
  async function searchTranscriptDocuments(uid, meetingId, query, limit = 5) {
    try {
      const transcriptsRef = collection(db, "users", uid, "meetings", meetingId, "transcripts");
      const snapshot = await getDocs(transcriptsRef);
      
      const searchResults = [];
      const queryLower = query.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter(word => word.length > 2);
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const transcript = data.transcript || data.content || "";
        const transcriptLower = transcript.toLowerCase();
        
        // Calculate relevance score
        let score = 0;
        let matchedPhrases = [];
        
        // Exact phrase matching (highest score)
        if (transcriptLower.includes(queryLower)) {
          score += 10;
          matchedPhrases.push(queryLower);
        }
        
        // Individual word matching
        queryWords.forEach(word => {
          const wordCount = (transcriptLower.match(new RegExp(word, 'g')) || []).length;
          score += wordCount * 2;
          if (wordCount > 0) matchedPhrases.push(word);
        });
        
        // Context extraction around matches
        if (score > 0) {
          const contexts = extractRelevantContexts(transcript, queryWords, queryLower);
          
          searchResults.push({
            docId: doc.id,
            score: score,
            transcript: transcript,
            contexts: contexts,
            matchedPhrases: matchedPhrases,
            timestamp: data.startTime || data.timestamp,
            status: data.status || 'unknown',
            wordCount: data.wordCount || transcript.split(/\s+/).length
          });
        }
      });
      
      // Sort by relevance score and return top results
      return searchResults
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
        
    } catch (error) {
      console.error("Error searching transcript documents:", error);
      return [];
    }
  }

  // Extract relevant context around search terms
  function extractRelevantContexts(transcript, queryWords, fullQuery, contextSize = 150) {
    const contexts = [];
    const sentences = transcript.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    // First try to find sentences containing the full query
    if (fullQuery.length > 3) {
      sentences.forEach((sentence, index) => {
        if (sentence.toLowerCase().includes(fullQuery)) {
          const start = Math.max(0, index - 1);
          const end = Math.min(sentences.length, index + 2);
          const context = sentences.slice(start, end).join('. ').trim();
          if (context.length > 20) {
            contexts.push({
              text: context,
              relevance: 10,
              type: 'exact_match'
            });
          }
        }
      });
    }
    
    // Then find sentences with multiple query words
    sentences.forEach((sentence, index) => {
      const sentenceLower = sentence.toLowerCase();
      const matchedWords = queryWords.filter(word => sentenceLower.includes(word));
      
      if (matchedWords.length >= Math.min(2, queryWords.length)) {
        const start = Math.max(0, index - 1);
        const end = Math.min(sentences.length, index + 2);
        const context = sentences.slice(start, end).join('. ').trim();
        
        if (context.length > 20 && !contexts.some(c => c.text === context)) {
          contexts.push({
            text: context,
            relevance: matchedWords.length,
            type: 'multi_word_match',
            matchedWords: matchedWords
          });
        }
      }
    });
    
    // Sort by relevance and limit context length
    return contexts
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 3)
      .map(context => ({
        ...context,
        text: context.text.length > contextSize 
          ? context.text.substring(0, contextSize) + "..."
          : context.text
      }));
  }

  // ENHANCED QUESTION ROUTING - This is the key improvement
  function analyzeQuestionIntent(query) {
    const queryLower = query.toLowerCase();
    if (/\.(pptx|docx?|pdf|txt|csv|md)$/i.test(queryLower)) return 'file_content';

    const patterns = {
      // Drive file operations
      drive_files: [
        /\b(show|give|list|display|find|what.*files?|which.*files?)\b.*\b(drive|folder|files?|documents?)\b/i,
        /\bfiles? in\b.*\b(drive|folder)\b/i,
        /\bwhat.*inside.*drive\b/i,
        /\blist.*documents?\b/i,
        /\bshow.*folder\b/i,
        /\bdrive folder\b/i
      ],
      
      // Specific file content queries  
      file_content: [
        /\b(?:_?[A-Za-z0-9\s-]+\.docx?)\b/i,
        /\b(?:_?[A-Za-z0-9\s-]+\.txt|\.csv|\.md|\.pdf|\.pptx)\b/i,

        // General "read file" or "open file"
        /\bread.*file/i,
        /\bopen.*file/i,
        /\bshow.*file/i,
        /\bextract.*from.*file/i,

        // Asking about content
        /\bwhat.*(?:inside|in|from).*file/i,
        /\bfile.*contains?\b/i,
        /\bcontents? of\b.*file/i,
        /\bdata.*in.*file/i,
        /\binfo.*from.*file/i,

        // Specific questions like your case
        /\bwhat.*project.*(?:discussed|in).*file/i,
        /\bname.*of.*project.*in.*file/i,
        /\b(?:title|name).*in.*(?:_?[A-Za-z0-9\s-]+\.docx?)\b/i
      ],

      // Meeting transcript queries
      meeting_transcript: [
        /\b(what.*did|who.*said|when.*did|how.*did|why.*did)\b/i,
        /\b(discuss|discussed|talk|talked|mention|mentioned|said|spoke)\b/i,
        /\b(meeting|conversation|call|session)\b/i,
        /\b(decide|decided|agree|agreed|conclude|concluded)\b/i,
        /\b(action.*item|next.*step|follow.*up|task)\b/i,
        /\bhappened.*in.*meeting\b/i,
        /\bwhat.*was.*discussed\b/i,
        /\bwho.*was.*present\b/i,
        /\bmeeting.*about\b/i,
        /\btranscript/i
      ],
      
      // Search within files
      search_files: [
        /\bsearch.*in.*files?\b/i,
        /\bfind.*in.*documents?\b/i,
        /\blook.*for.*in.*drive\b/i,
        /\bsearch.*drive.*for\b/i
      ],
      
      // General file search
      file_search: [
        /\bsearch\b.*\bfor\b/i,
        /\bfind\b.*\bfile/i,
        /\blook.*for\b/i
      ]
    };
    
    // Check each pattern category
    for (const [intent, regexArray] of Object.entries(patterns)) {
      if (regexArray.some(regex => regex.test(queryLower))) {
        return intent;
      }
    }
    
    // Default to general if no specific pattern matches
    return 'general';
  }

  function detectExplicitFileOrTranscriptMention(query) {
    const lower = query.toLowerCase();

    const mentionsSpecificFile = /\b[\w\s-]+\.(docx?|pdf|txt|csv|md|pptx)\b/i.test(lower);
    const mentionsTranscriptOnly = /\b(transcript|meeting|conversation|call|session)\b/i.test(lower);

    return {
      mentionsSpecificFile,
      mentionsTranscriptOnly
    };
  }

  // Enhanced function to determine if query needs transcript search
  function needsTranscriptSearch(query) {
    const intent = analyzeQuestionIntent(query);
    return intent === 'meeting_transcript';
  }

  // Enhanced function to determine if query needs drive file access
  function needsDriveAccess(query) {
    const intent = analyzeQuestionIntent(query);
    return ['drive_files', 'file_content', 'search_files', 'file_search'].includes(intent);
  }

  // Enhanced function to search files by content
  async function searchFilesContent(filesContentMap, query, limit = 3) {
    const results = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(word => word.length > 2);
    
    for (const [filename, content] of Object.entries(filesContentMap)) {
      if (!content || content.length === 0) continue;
      
      const contentLower = content.toLowerCase();
      let score = 0;
      let matchedPhrases = [];
      
      // Exact phrase matching
      if (contentLower.includes(queryLower)) {
        score += 10;
        matchedPhrases.push(queryLower);
      }
      
      // Individual word matching
      queryWords.forEach(word => {
        const wordCount = (contentLower.match(new RegExp(word, 'g')) || []).length;
        score += wordCount * 2;
        if (wordCount > 0) matchedPhrases.push(word);
      });
      
      if (score > 0) {
        // Extract relevant contexts from file content
        const contexts = extractRelevantContextsFromFile(content, queryWords, queryLower);
        
        results.push({
          filename: filename,
          score: score,
          content: content,
          contexts: contexts,
          matchedPhrases: matchedPhrases
        });
      }
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Extract contexts from file content
  function extractRelevantContextsFromFile(content, queryWords, fullQuery, contextSize = 200) {
    const contexts = [];
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 10);
    
    // First try full query matches
    if (fullQuery.length > 3) {
      paragraphs.forEach(paragraph => {
        if (paragraph.toLowerCase().includes(fullQuery)) {
          contexts.push({
            text: paragraph.length > contextSize ? paragraph.substring(0, contextSize) + "..." : paragraph,
            relevance: 10,
            type: 'exact_match'
          });
        }
      });
    }
    
    // Then try multi-word matches
    paragraphs.forEach(paragraph => {
      const paragraphLower = paragraph.toLowerCase();
      const matchedWords = queryWords.filter(word => paragraphLower.includes(word));
      
      if (matchedWords.length >= Math.min(2, queryWords.length)) {
        const truncated = paragraph.length > contextSize ? paragraph.substring(0, contextSize) + "..." : paragraph;
        if (!contexts.some(c => c.text === truncated)) {
          contexts.push({
            text: truncated,
            relevance: matchedWords.length,
            type: 'multi_word_match',
            matchedWords: matchedWords
          });
        }
      }
    });
    
    return contexts
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 2);
  }

  // Enhanced question categorization for better responses
  function categorizeQuestion(query) {
    const categories = {
      'decision': ['decide', 'decided', 'resolution', 'concluded', 'agreed', 'consensus'],
      'action_item': ['action', 'next steps', 'follow up', 'todo', 'task', 'assign'],
      'person_specific': ['who said', 'who mentioned', 'person said', 'someone said'],
      'topic_discussion': ['discuss', 'talk about', 'mention', 'bring up', 'address'],
      'timeline': ['when', 'time', 'date', 'schedule', 'deadline'],
      'opinion': ['think', 'opinion', 'believe', 'feel', 'thought'],
      'explanation': ['explain', 'how', 'why', 'what is', 'definition'],
      'summary': ['summary', 'overview', 'main points', 'key points', 'recap'],
      'file_operation': ['file', 'document', 'drive', 'folder', 'content'],
      'search': ['find', 'search', 'look for', 'locate']
    };
    
    const queryLower = query.toLowerCase();
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => queryLower.includes(keyword))) {
        return category;
      }
    }
    return 'general';
  }

  // ENHANCED AI RESPONSE FUNCTION WITH SEMANTIC SEARCH
  async function getEnhancedAIResponseWithSemantics(input, selectedMeeting, userUid, filesContentMap, getAIResponse) {
    const questionIntent = analyzeQuestionIntent(input);
    const questionCategory = categorizeQuestion(input);

    const { mentionsSpecificFile, mentionsTranscriptOnly } = detectExplicitFileOrTranscriptMention(input);

    // Default behavior: check both, unless explicitly limited
    const needsTranscriptLookup = mentionsTranscriptOnly || (!mentionsSpecificFile && !mentionsTranscriptOnly);
    const needsFileAccess = mentionsSpecificFile || (!mentionsSpecificFile && !mentionsTranscriptOnly);

    console.log(`🤖 AI Analysis: Intent="${questionIntent}", Category="${questionCategory}"`);
    
    let transcriptContext = "";
    let searchResults = [];
    let enhancedSearchResults = null;
    
    // Handle transcript-related questions
    if (needsTranscriptLookup && selectedMeeting?.meetingId) {
      console.log(`🔍 Searching transcripts for: ${input}`);
      
      searchResults = await searchTranscriptDocuments(userUid, selectedMeeting.meetingId, input);
      
      if (searchResults.length > 0) {
        transcriptContext = searchResults.map((result, index) => {
          const contextTexts = result.contexts.map(ctx => `"${ctx.text}"`).join('\n');
          return `Transcript excerpt ${index + 1} (relevance: ${result.score}):\n${contextTexts}`;
        }).join('\n\n');
        console.log(`✅ Found ${searchResults.length} relevant transcript sections`);
      } else {
        // Fallback to full transcript
        try {
          transcriptContext = await loadTranscript(userUid, selectedMeeting.meetingId);
          console.log("📄 Using full transcript as fallback");
        } catch (err) {
          transcriptContext = "No transcript available for this meeting.";
          console.warn("❌ Transcript access failed:", err);
        }
      }
    }
    
    // Handle file-related questions with enhanced semantic search
    if (needsFileAccess && filesContentMap && Object.keys(filesContentMap).length > 0) {
      console.log(`📁 Performing enhanced search for: ${input}`);
      
      try {
        enhancedSearchResults = await performEnhancedSearch(input, filesContentMap, searchResults);
        console.log(`🎯 Enhanced search completed:`, {
          semantic: enhancedSearchResults.semanticResults.length,
          keyword: enhancedSearchResults.keywordResults.length,
          transcript: enhancedSearchResults.transcriptResults.length,
          combined: enhancedSearchResults.combinedResults.length
        });
      } catch (error) {
        console.error('Enhanced search failed, falling back to keyword search:', error);
        enhancedSearchResults = {
          semanticResults: [],
          keywordResults: await searchFilesContent(filesContentMap, input),
          transcriptResults: searchResults,
          combinedResults: [],
          totalRelevantChunks: 0
        };
      }
    }

    // Build enhanced system prompt based on question intent
    const today = new Date().toLocaleDateString("en-US", {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    
    let systemPrompt = `You are an intelligent meeting assistant with access to meeting transcripts and documents. You now have advanced semantic search capabilities.

Today's date: ${today}

QUESTION ANALYSIS:
- Intent: ${questionIntent.toUpperCase()}
- Category: ${questionCategory.toUpperCase()}
- Needs transcript data: ${needsTranscriptLookup}
- Needs file data: ${needsFileAccess}
- Semantic Search: ${enhancedSearchResults ? 'ENABLED' : 'DISABLED'}

`;

    // Add enhanced context from semantic search
    if (enhancedSearchResults && enhancedSearchResults.combinedResults.length > 0) {
      const enhancedContext = buildEnhancedContext(enhancedSearchResults.combinedResults);
      systemPrompt += `SEMANTIC SEARCH RESULTS:\n${enhancedContext}\n`;
      
      systemPrompt += `SEARCH PERFORMANCE:
- Semantic matches: ${enhancedSearchResults.semanticResults.length}
- Keyword matches: ${enhancedSearchResults.keywordResults.length}
- Transcript matches: ${enhancedSearchResults.transcriptResults.length}
- Combined relevant results: ${enhancedSearchResults.combinedResults.length}

`;
    }

    // Add transcript context if available
    if (transcriptContext && transcriptContext.length > 0) {
      systemPrompt += `MEETING TRANSCRIPT CONTEXT:\n${transcriptContext}\n\n`;
    }

    // Add specific instructions based on intent
    systemPrompt += `RESPONSE INSTRUCTIONS:
`;

    switch (questionIntent) {
      case 'drive_files':
        systemPrompt += `- Focus on listing and describing the available files in the Drive folder
- Provide file names and brief descriptions of their contents
- If no files are available, clearly state this`;
        break;
      
      case 'file_content':
        systemPrompt += `- Focus on the specific content of the requested file
- Provide detailed information from the file if available
- If the file isn't found, suggest alternatives`;
        break;
      
      case 'meeting_transcript':
        systemPrompt += `- Focus on information from the meeting transcript
- Provide specific quotes and references when possible
- If information isn't in the transcript, clearly state this
- Be specific about who said what and when (if available)`;
        break;
      
      case 'search_files':
        systemPrompt += `- Focus on search results from within the file contents
- Highlight the most relevant matches
- Provide context around the found information`;
        break;
      
      default:
        systemPrompt += `- Use the semantic search results as your primary source of information
- Prioritize information from higher relevance scores
- When referencing information, mention the source document name
- If semantic search found relevant content, focus on that over general knowledge
- Provide specific quotes when available
- If no relevant information was found, clearly state this`;
    }

    systemPrompt += `
- Be conversational and natural
- Use quotation marks for direct quotes from transcripts or files
- If asked about something not in the available data, clearly state this
- Provide specific, actionable information when possible

${selectedMeeting ? `
MEETING DETAILS (reference only when specifically asked):
- Meeting Date: ${new Date(selectedMeeting.meetingDate).toLocaleDateString("en-US", {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })}
- Meeting Time: ${selectedMeeting.meetingTime}
- Status: ${getMeetingStatus(selectedMeeting.meetingDate)}
` : ""}`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input }
    ];

    try {
      const aiReply = await getAIResponse(messages);
      return {
        response: aiReply,
        searchResults: enhancedSearchResults || { combinedResults: [] },
        hasSemanticResults: enhancedSearchResults?.semanticResults?.length > 0,
        hasKeywordResults: enhancedSearchResults?.keywordResults?.length > 0,
        hasTranscriptContext: transcriptContext.length > 0,
        hasFileContext: enhancedSearchResults?.combinedResults?.length > 0,
        questionIntent: questionIntent,
        questionCategory: questionCategory,
        semanticScore: enhancedSearchResults?.combinedResults?.[0]?.similarity || 0,
        searchTerms: [...(searchResults.length > 0 ? searchResults[0].matchedPhrases : []), 
                      ...(enhancedSearchResults?.keywordResults?.length > 0 ? enhancedSearchResults.keywordResults[0].matchedPhrases : [])]
      };
    } catch (error) {
      console.error("AI response error:", error);
      return {
        response: "I'm having trouble processing your request right now. Please try again.",
        searchResults: { combinedResults: [] },
        hasSemanticResults: false,
        hasKeywordResults: false,
        hasTranscriptContext: false,
        hasFileContext: false,
        questionIntent: 'error',
        questionCategory: 'error',
        semanticScore: 0,
        searchTerms: []
      };
    }
  }

  // Function to highlight search terms in response
  function highlightSearchTerms(text, searchTerms) {
    if (!searchTerms || searchTerms.length === 0) return text;

    let highlightedText = text;

    searchTerms.forEach(term => {
        // Properly escape special regex characters
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Match whole word with word boundaries and ignore case
        const regex = new RegExp(`\\b(${escapedTerm})\\b`, 'gi');
        highlightedText = highlightedText.replace(regex, '<mark>$1</mark>');
    });

    return highlightedText;
}

  function getMeetingStatus(meetingDateStr) {
    const today = new Date();
    const meetingDate = new Date(meetingDateStr);

    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const meetingOnly = new Date(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());

    if (meetingOnly.getTime() === todayOnly.getTime()) return "today";
    if (meetingOnly < todayOnly) return "in the past";
    return "upcoming";
  }

  // Helper functions for Drive API
  function extractFolderId(driveUrl) {
    if (!driveUrl) return null;
    const match = driveUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  function linkify(text) {
    const urlPattern = /https?:\/\/[^\s"<>]+/g;
    return text.replace(urlPattern, (url) => {
      const safeUrl = url.replace(/"/g, "");
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
  }

  function getAuthToken() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });
  }

  // ENHANCED DRIVE FUNCTIONS - FIXED VERSION

  // Enhanced function to verify folder access and get fresh data
  async function verifyFolderAccess(folderId, token) {
    try {
      // First, verify we can access the folder itself
      const folderRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`,
        {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!folderRes.ok) {
        throw new Error(`Cannot access folder: ${folderRes.status}`);
      }

      const folderData = await folderRes.json();
      
      if (folderData.trashed) {
        throw new Error('Folder is in trash');
      }

      if (folderData.mimeType !== 'application/vnd.google-apps.folder') {
        throw new Error('ID does not point to a folder');
      }

      console.log(`✅ Folder verified: ${folderData.name}`);
      return folderData;
    } catch (error) {
      console.error('Folder verification failed:', error);
      throw error;
    }
  }

  // Enhanced file size formatting function
  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    if (isNaN(bytes)) return 'Unknown size';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Enhanced function to list all files in folder recursively with proper filtering
  async function listFilesInFolder(folderId, token) {
    const files = [];

    async function recurse(folderId, path = "") {
      try {
        // Enhanced query to exclude trashed files and include more fields
        const query = `'${folderId}' in parents and trashed=false`;
        const fields = 'files(id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed)';
        
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${fields}&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000`,
          {
            headers: { 
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (!res.ok) {
          console.error(`Drive API error: ${res.status} - ${res.statusText}`);
          const errorText = await res.text();
          console.error('Error details:', errorText);
          throw new Error(`Drive API error: ${res.status}`);
        }
        
        const data = await res.json();
        console.log(`📁 Found ${data.files?.length || 0} files in folder ${folderId}`);

        if (!data.files || !Array.isArray(data.files)) {
          console.warn('No files array in response:', data);
          return;
        }

        for (const file of data.files) {
          // Double-check that file is not trashed
          if (file.trashed === true) {
            console.log(`Skipping trashed file: ${file.name}`);
            continue;
          }

          const fullPath = path ? `${path}/${file.name}` : file.name;
          
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            console.log(`📂 Entering subfolder: ${fullPath}`);
            await recurse(file.id, fullPath);
          } else {
            // Validate file has required properties
            if (file.id && file.name) {
              files.push({
                ...file,
                path: fullPath,
                // Fix the size display issue
                displaySize: file.size ? formatFileSize(parseInt(file.size)) : 'Unknown size'
              });
              console.log(`📄 Added file: ${file.name} (${file.displaySize})`);
            }
          }
        }
      } catch (error) {
        console.error(`Error accessing folder ${folderId}:`, error);
        // Don't throw here to prevent one bad folder from breaking everything
      }
    }

    await recurse(folderId);
    console.log(`✅ Total files collected: ${files.length}`);
    return files;
  }

  // Enhanced function to get fresh file list with cache invalidation
  async function getFreshFileList(folderId, token, forceRefresh = false) {
    const cacheKey = `drive_files_${folderId}`;
    const cacheTimeKey = `drive_files_time_${folderId}`;
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    try {
      // Check cache if not forcing refresh
      if (!forceRefresh) {
        const cachedData = await chrome.storage.local.get([cacheKey, cacheTimeKey]);
        if (cachedData[cacheKey] && cachedData[cacheTimeKey]) {
          const cacheAge = Date.now() - cachedData[cacheTimeKey];
          if (cacheAge < CACHE_DURATION) {
            console.log('📦 Using cached file list');
            return cachedData[cacheKey];
          }
        }
      }

      console.log('🔄 Fetching fresh file list from Drive...');
      
      // Verify folder access first
      await verifyFolderAccess(folderId, token);
      
      // Get fresh file list
      const files = await listFilesInFolder(folderId, token);
      
      // Cache the results
      await chrome.storage.local.set({
        [cacheKey]: files,
        [cacheTimeKey]: Date.now()
      });

      console.log(`✅ Cached ${files.length} files`);
      return files;
      
    } catch (error) {
      console.error('Error getting fresh file list:', error);
      throw error;
    }
  }

  // Enhanced function to download different file types
  async function downloadGoogleDocAsText(fileId, token) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to download Google Doc: ' + res.status);
    return await res.text();
  }

  async function downloadPlainTextFile(fileId, token) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to download text file: ' + res.status);
    return await res.text();
  }

  function loadMammothIfNeeded() {
    return new Promise((resolve, reject) => {
      if (window.mammoth) return resolve(window.mammoth);

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("libs/mammoth.browser.min.js");
      script.onload = () => resolve(window.mammoth);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadPptxParserIfNeeded() {
    return new Promise((resolve, reject) => {
      if (window.pptxToText) return resolve(window.pptxToText);

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("libs/pptx-parser.js");
      script.onload = () => resolve(window.pptxToText);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Load pdf.js and pdf.worker.js if not already loaded
  function loadPdfJSIfNeeded() {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("libs/pdf.js");

      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          chrome.runtime.getURL("libs/pdf.worker.js");
        resolve(window.pdfjsLib);
      };

      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Function to download and process different file types
  async function downloadFileContent(file, token) {
    try {
      let content = "";

      switch (file.mimeType) {
        case 'application/vnd.google-apps.document':
          content = await downloadGoogleDocAsText(file.id, token);
          break;

        case 'text/plain':
        case 'text/csv':
        case 'text/markdown':
          content = await downloadPlainTextFile(file.id, token);
          break;

        case 'application/vnd.google-apps.spreadsheet': {
          const csvRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (csvRes.ok) {
            content = await csvRes.text();
          }
          break;
        }

        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
          const blobRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` }
          });

          if (!blobRes.ok) throw new Error(`Failed to download DOCX file: ${blobRes.status}`);
          const blob = await blobRes.blob();
          const arrayBuffer = await blob.arrayBuffer();

          await loadMammothIfNeeded();
          const { convertToHtml } = window.mammoth;

          const result = await convertToHtml({ arrayBuffer });
          content = result.value.replace(/<[^>]+>/g, ''); // Strip HTML tags
          break;
        }

        case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
          const blobRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` }
          });

          if (!blobRes.ok) throw new Error(`Failed to download PPTX file: ${blobRes.status}`);
          const blob = await blobRes.blob();
          const arrayBuffer = await blob.arrayBuffer();

          await loadPptxParserIfNeeded();
          const text = await window.pptxToText(arrayBuffer);
          content = text;
          break;
        }

        case 'application/pdf': {
          const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${token}` }
          });

          if (!res.ok) throw new Error(`Failed to download PDF file: ${res.status}`);
          const blob = await res.blob();
          const arrayBuffer = await blob.arrayBuffer();

          await loadPdfJSIfNeeded();

          const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

          let text = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const pageContent = await page.getTextContent();
            const pageText = pageContent.items.map(item => item.str).join(" ");
            text += pageText + "\n\n";
          }

          content = text;
          break;
        }

        default:
          console.log(`Unsupported file type: ${file.mimeType} for file: ${file.name}`);
          return null;
      }

      return content;
    } catch (error) {
      console.error(`Error downloading file ${file.name}:`, error);
      return null;
    }
  }

  // Enhanced search function with better filtering
  async function searchFilesRecursively(folderId, queryText, token) {
    const matches = [];

    async function searchFolder(folderId, path = "") {
      try {
        // Build proper query to exclude trashed files
        let query = `'${folderId}' in parents and trashed=false`;
        if (queryText && queryText.trim()) {
          // Add name search to the query
          query += ` and name contains '${queryText.replace(/'/g, "\\'")}'`;
        }

        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,webViewLink,size,modifiedTime,trashed)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000`;

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (res.status === 403) {
          const err = new Error("Access denied to Drive folder");
          err.status = 403;
          throw err;
        }

        if (!res.ok) {
          throw new Error(`Drive API error: ${res.status}`);
        }

        const data = await res.json();

        if (!data.files || !Array.isArray(data.files)) {
          console.error("Drive API error or no files:", data);
          return;
        }

        console.log(`🔍 Search found ${data.files.length} matches in folder`);

        for (const file of data.files) {
          // Skip trashed files (double check)
          if (file.trashed === true) continue;

          const fullPath = path ? `${path}/${file.name}` : file.name;
          
          // Add matched file
          matches.push({
            ...file,
            path: fullPath,
            displaySize: file.size ? formatFileSize(parseInt(file.size)) : 'Unknown size'
          });
          
          // If it's a folder, search recursively
          if (file.mimeType === "application/vnd.google-apps.folder") {
            await searchFolder(file.id, fullPath);
          }
        }
      } catch (error) {
        console.error(`Error searching folder ${folderId}:`, error);
        if (error.status === 403) {
          throw error;
        }
      }
    }

    await searchFolder(folderId);
    console.log(`🔍 Total search results: ${matches.length}`);
    return matches;
  }

  // Clear cache function (call this when you want to force refresh)
  async function clearDriveCache(folderId = null) {
    try {
      if (folderId) {
        // Clear cache for specific folder
        const cacheKey = `drive_files_${folderId}`;
        const cacheTimeKey = `drive_files_time_${folderId}`;
        await chrome.storage.local.remove([cacheKey, cacheTimeKey]);
        console.log(`🗑️ Cleared cache for folder ${folderId}`);
      } else {
        // Clear all drive caches
        const allData = await chrome.storage.local.get();
        const keysToRemove = Object.keys(allData).filter(key => 
          key.startsWith('drive_files_') || key.startsWith('drive_files_time_')
        );
        if (keysToRemove.length > 0) {
          await chrome.storage.local.remove(keysToRemove);
          console.log(`🗑️ Cleared ${keysToRemove.length} drive cache entries`);
        }
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  // Chat message functions
  async function saveChatMessage(uid, meetingId, role, content) {
    try {
      const chatRef = collection(db, "users", uid, "meetings", meetingId, "chats");
      await addDoc(chatRef, {
        role,
        content,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error("❌ Failed to save chat message:", err);
    }
  }

  async function loadChatHistory(uid, meetingId) {
    const chatRef = collection(db, "users", uid, "meetings", meetingId, "chats");
    const q = query(chatRef, orderBy("timestamp", "asc"));

    try {
      const snapshot = await getDocs(q);
      snapshot.forEach(doc => {
        const { role, content } = doc.data();
        const bubble = document.createElement("div");
        bubble.className = `chat-bubble ${role === "user" ? "user-bubble" : "ai-bubble"}`;
        bubble.innerHTML = linkify(content);
        chatMessages.appendChild(bubble);
      });
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch (err) {
      console.error("❌ Failed to load chat history:", err);
    }
  }

  // Main chat interface code - DECLARE VARIABLES FIRST
  let chatMessages, chatInput, micBtn, voiceReplyToggle, sendBtn;
  let synth, recognition;
  let isMicActive = false;
  let selectedMeeting = null;
  let userUid = null;
  let isProcessing = false;
  const filesContentMap = {};

  // Main chat interface initialization
  import('./ai-helper.js').then(({ getAIResponse }) => {
    // Get DOM elements
    chatMessages = document.getElementById("chatMessages");
    chatInput = document.getElementById("chatInput");
    micBtn = document.getElementById("micBtn");
    voiceReplyToggle = document.getElementById("voiceReplyToggle");
    sendBtn = document.getElementById("sendBtn");

    if (!chatMessages) {
      console.error("Error: Element with id 'chatMessages' not found in the DOM.");
      return;
    }
    if (!chatInput) {
      console.error("Error: Element with id 'chatInput' not found in the DOM.");
      return;
    }
    if (!micBtn) {
      console.warn("Warning: Element with id 'micBtn' not found; microphone functionality will be disabled.");
    }
    if (!voiceReplyToggle) {
      console.warn("Warning: Element with id 'voiceReplyToggle' not found; voice reply toggle will be disabled.");
    }
    if (!sendBtn) {
      console.warn("Warning: Element with id 'sendBtn' not found; send button functionality will be disabled.");
    }

    synth = window.speechSynthesis;

    function initSpeechRecognition() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.warn("Speech Recognition not supported in this browser.");
        if (micBtn) micBtn.disabled = true;
        return;
      }

      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        isMicActive = true;
        if (micBtn) {
          micBtn.textContent = '●';
          micBtn.style.color = 'red';
          micBtn.title = 'Listening... Click to stop';
        }
      };

      recognition.onend = () => {
        isMicActive = false;
        if (micBtn) {
          micBtn.textContent = '🎤';
          micBtn.style.color = '';
          micBtn.title = 'Speak your question';
        }
      };

      recognition.onerror = (e) => {
        console.error("Speech error:", e.error);
        isMicActive = false;
        if (micBtn) {
          micBtn.textContent = '🎤';
          micBtn.style.color = '';
          micBtn.title = 'Speak your question';
        }
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        if (chatInput) {
          chatInput.value = transcript;
          chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        }
      };
    }

    // Load meeting data and chat history
    chrome.storage.local.get(["selectedMeetingForChat", "uid"], async (result) => {
      if (result.selectedMeetingForChat && result.uid) {
        selectedMeeting = result.selectedMeetingForChat;
        userUid = result.uid;

        if (selectedMeeting.meetingId) {
          await loadChatHistory(userUid, selectedMeeting.meetingId);
        }

        // Pre-load Drive files for better performance
        await preloadDriveFiles();
      } else {
        console.warn("No meeting selected. Please open chat from the dashboard after selecting a meeting.");
        if (chatMessages) {
          const warningBubble = document.createElement("div");
          warningBubble.className = "chat-bubble ai-bubble";
          warningBubble.innerHTML = "⚠️ No meeting selected. Please open chat from the dashboard after selecting a meeting.";
          chatMessages.appendChild(warningBubble);
        }
      }
    });

    // Function to preload Drive files
    async function preloadDriveFiles() {
      if (!selectedMeeting?.driveFolderLink) {
        console.log("No Drive folder link available");
        return;
      }
      
      const folderId = extractFolderId(selectedMeeting.driveFolderLink);
      if (!folderId) {
        console.log("Could not extract folder ID from Drive link");
        return;
      }

      try {
        console.log("🔄 Preloading Drive files...");
        const token = await getAuthToken();
        const files = await getFreshFileList(folderId, token);

        const supportedFiles = files.filter(f =>
          f.mimeType === "text/plain" ||
          f.mimeType === "application/vnd.google-apps.document" ||
          f.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          f.mimeType === "application/pdf" ||
          f.mimeType === "text/csv" ||
          f.mimeType === "text/markdown" ||
          f.mimeType === "application/vnd.google-apps.spreadsheet"|| 
          f.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );

        console.log(`📁 Found ${supportedFiles.length} supported files out of ${files.length} total files`);

        // Load content for smaller files (under 5MB)
        let loadedCount = 0;
        const maxFilesToLoad = 10;
        
        for (const file of supportedFiles.slice(0, maxFilesToLoad)) {
          console.log("🧪 Preloading:", file.name, file.mimeType, file.size);

          // Skip files larger than 5MB or if size is undefined (treat undefined as small)
          if (file.size && parseInt(file.size) >= 5000000) {
            console.log(`⛔ Skipped (too large): ${file.name} (${file.size} bytes)`);
            continue;
          }

          try {
            const content = await downloadFileContent(file, token);

            if (content && content.trim().length > 0) {
              const fileKey = file.name.toLowerCase();
              filesContentMap[fileKey] = content;
              loadedCount++;
              console.log(`📄 Loaded: ${file.name} (${content.length} chars)`);
            } else {
              console.warn(`⚠️ No content extracted from: ${file.name}`);
            }

          } catch (error) {
            console.warn(`❌ Failed to load file ${file.name}:`, error);
          }
        }

        console.log(`✅ Preloaded ${loadedCount} files successfully`);
        console.log(`📝 Files in memory:`, Object.keys(filesContentMap));
        
      } catch (error) {
        console.warn("⚠️ Failed to preload Drive files:", error);
      }
    }

    // Enhanced chat input handler with semantic search
    chatInput.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || isProcessing) return;
      console.log("🎯 Processing input with semantic search:", chatInput.value);
      isProcessing = true;

      const input = chatInput.value.trim();
      if (!input) {
        isProcessing = false;
        return;
      }

      chatInput.value = "";
      chatInput.focus();

      // Add user message
      const userBubble = document.createElement("div");
      userBubble.className = "chat-bubble user-bubble";
      userBubble.textContent = input;
      chatMessages.appendChild(userBubble);

      if (userUid && selectedMeeting?.meetingId) {
        saveChatMessage(userUid, selectedMeeting.meetingId, "user", input);
      }

      // Add thinking bubble
      const aiBubble = document.createElement("div");
      aiBubble.className = "chat-bubble ai-bubble";
      aiBubble.innerHTML = '<div class="typing-indicator">🧠 Analyzing with semantic search...</div>';
      chatMessages.appendChild(aiBubble);

      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

      if (!selectedMeeting) {
        aiBubble.innerHTML = "⚠️ No meeting data found. Please select a meeting first.";
        isProcessing = false;
        return;
      }

      try {
        // Analyze the question intent
        const questionIntent = analyzeQuestionIntent(input);
        console.log(`🧠 Question intent: ${questionIntent}`);

        // Handle different types of questions
        if (questionIntent === 'drive_files') {
          await handleDriveFilesQuery(input, aiBubble);
        } else if (questionIntent === 'file_search' || questionIntent === 'search_files') {
          await handleFileSearchQuery(input, aiBubble);
        } else {
          // Use enhanced AI response with semantic search
          await handleGeneralQueryWithSemantics(input, aiBubble);
        }

      } catch (error) {
        console.error("❌ Error processing query:", error);
        aiBubble.innerHTML = "⚠️ Sorry, I encountered an error processing your request. Please try again.";
      }

      isProcessing = false;
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    // Enhanced drive files query handler with better error handling
    async function handleDriveFilesQuery(input, aiBubble) {
      const folderId = extractFolderId(selectedMeeting.driveFolderLink);
      if (!folderId) {
        aiBubble.innerHTML = "⚠️ Could not extract folder ID from Drive link. Please check the folder link format.";
        return;
      }

      try {
        aiBubble.innerHTML = '<div class="typing-indicator">📁 Accessing Drive folder...</div>';
        
        const token = await getAuthToken();
        
        // Force refresh to get current state
        const files = await getFreshFileList(folderId, token, true);

        if (files.length === 0) {
          aiBubble.innerHTML = `📂 Your Drive folder appears to be empty or contains no accessible files.<br><br>
            <a href="${selectedMeeting.driveFolderLink}" target="_blank" rel="noopener noreferrer">Open folder in Drive</a> to verify.`;
          return;
        }

        // Group files by type
        const filesByType = {};
        files.forEach(file => {
          const type = getFileTypeCategory(file.mimeType);
          if (!filesByType[type]) filesByType[type] = [];
          filesByType[type].push(file);
        });

        let response = `📁 **Found ${files.length} files in your Drive folder:**<br><br>`;
        
        for (const [type, typeFiles] of Object.entries(filesByType)) {
          response += `<strong>${type} (${typeFiles.length}):</strong><br>`;
          typeFiles.forEach(file => {
            const sizeDisplay = file.displaySize || 'Unknown size';
            const modifiedDate = file.modifiedTime ? 
              new Date(file.modifiedTime).toLocaleDateString() : '';
            const dateStr = modifiedDate ? ` • Modified: ${modifiedDate}` : '';
            
            response += `• <a href="${file.webViewLink}" target="_blank" rel="noopener noreferrer">${file.name}</a> (${sizeDisplay}${dateStr})<br>`;
          });
          response += '<br>';
        }

        response += `<small>🔄 <em>Data refreshed at ${new Date().toLocaleTimeString()}</em></small>`;

        aiBubble.innerHTML = response;

        if (userUid && selectedMeeting.meetingId) {
          const plainResponse = aiBubble.textContent || aiBubble.innerText;
          saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", plainResponse);
        }

      } catch (err) {
        console.error("Drive API error:", err);
        if (err && err.status === 403) {
          aiBubble.innerHTML = `⚠️ Access denied to the Drive folder.<br><br>
            This could mean:<br>
            • You don't have permission to view this folder<br>
            • The folder has been moved or deleted<br>
            • The sharing settings have changed<br><br>
            <a href="${selectedMeeting.driveFolderLink}" target="_blank" rel="noopener noreferrer">Try accessing the folder directly</a>`;
        } else {
          aiBubble.innerHTML = `❌ Error accessing Google Drive: ${err.message}<br><br>
            Please try:<br>
            • Refreshing your browser<br>
            • Re-authorizing the extension<br>
            • Checking your internet connection<br><br>
            <a href="${selectedMeeting.driveFolderLink}" target="_blank" rel="noopener noreferrer">Open folder in Drive</a>`;
        }
      }
    }

    // Handle file search queries
    async function handleFileSearchQuery(input, aiBubble) {
      const keyword = extractSearchKeyword(input);
      const folderId = extractFolderId(selectedMeeting.driveFolderLink);
      
      if (!folderId) {
        aiBubble.innerHTML = "⚠️ Could not access Drive folder.";
        return;
      }

      try {
        aiBubble.innerHTML = '<div class="typing-indicator">🔍 Searching files...</div>';
        
        const token = await getAuthToken();
        
        // Search by filename
        const fileMatches = await searchFilesRecursively(folderId, keyword, token);
        
        // Search within file contents
        const contentMatches = await searchFilesContent(filesContentMap, input);
        
        let response = "";
        
        if (fileMatches.length > 0) {
          response += `📄 <strong>Files matching "${keyword}":</strong><br>`;
          fileMatches.slice(0, 5).forEach(file => {
            response += `• <a href="${file.webViewLink}" target="_blank" rel="noopener noreferrer">${file.name}</a><br>`;
          });
          response += '<br>';
        }
        
        if (contentMatches.length > 0) {
          response += `📝 <strong>Content found in files:</strong><br>`;
          contentMatches.forEach(match => {
            response += `<strong>${match.filename}</strong> (relevance: ${match.score})<br>`;
            match.contexts.forEach(ctx => {
              response += `<blockquote>${ctx.text}</blockquote>`;
            });
            response += '<br>';
          });
        }
        
        if (fileMatches.length === 0 && contentMatches.length === 0) {
          response = `🔍 No files or content found matching "${keyword}"`;
        }

        aiBubble.innerHTML = response;

        if (userUid && selectedMeeting.meetingId) {
          const plainResponse = aiBubble.textContent || aiBubble.innerText;
          saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", plainResponse);
        }

      } catch (error) {
        console.error("Search error:", error);
        aiBubble.innerHTML = "❌ Error searching files.";
      }
    }

    // Handle general queries with enhanced semantic search
    async function handleGeneralQueryWithSemantics(input, aiBubble) {
      aiBubble.innerHTML = '<div class="typing-indicator">🧠 Thinking with semantic search...</div>';

      // Load additional files if needed
      await ensureFilesLoaded();

      try {
        // Use the enhanced AI response function with semantic search
        const enhancedResponse = await getEnhancedAIResponseWithSemantics(
          input, selectedMeeting, userUid, filesContentMap, getAIResponse
        );

        // Display the AI response with highlighting
        const responseText = highlightSearchTerms(enhancedResponse.response, enhancedResponse.searchTerms);
        aiBubble.innerHTML = linkify(responseText);

        // Add enhanced context indicators
        const indicators = [];
        if (enhancedResponse.hasSemanticResults) {
          indicators.push(`🧠 Semantic (${enhancedResponse.searchResults.semanticResults?.length || 0} matches)`);
        }
        if (enhancedResponse.hasKeywordResults) {
          indicators.push(`🔍 Keyword (${enhancedResponse.searchResults.keywordResults?.length || 0} matches)`);
        }
        if (enhancedResponse.hasTranscriptContext) {
          indicators.push(`📝 Transcript`);
        }

        if (indicators.length > 0) {
          const contextInfo = document.createElement("div");
          contextInfo.className = "context-info";
          contextInfo.style.cssText = `
            font-size: 0.8em; 
            color: #666; 
            margin-top: 8px; 
            padding: 6px 10px; 
            background: linear-gradient(135deg, #f0f8ff, #e6f3ff); 
            border-radius: 12px; 
            border-left: 3px solid #4CAF50;
            font-style: italic;
          `;
          
          const semanticScore = enhancedResponse.semanticScore > 0 
            ? ` • Relevance: ${(enhancedResponse.semanticScore * 100).toFixed(1)}%` 
            : '';
          
          contextInfo.innerHTML = `✨ ${indicators.join(' • ')} • Intent: ${enhancedResponse.questionIntent}${semanticScore}`;
          aiBubble.appendChild(contextInfo);
        }

        if (userUid && selectedMeeting.meetingId) {
          saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", enhancedResponse.response);
        }

        // Voice response if enabled
        if (voiceReplyToggle && voiceReplyToggle.checked && synth) {
          speakResponse(enhancedResponse.response);
        }

      } catch (error) {
        console.error("AI response error:", error);
        aiBubble.innerHTML = "⚠️ Failed to get AI response. Please try again.";
      }
    }

    // Helper functions
    function getFileTypeCategory(mimeType) {
      if (mimeType.includes('document')) return 'Documents';
      if (mimeType.includes('spreadsheet')) return 'Spreadsheets';
      if (mimeType.includes('presentation')) return 'Presentations';
      if (mimeType.includes('text')) return 'Text Files';
      if (mimeType.includes('image')) return 'Images';
      if (mimeType.includes('pdf')) return 'PDFs';
      return 'Other Files';
    }

    function extractSearchKeyword(input) {
      const patterns = [
        /find\s+"([^"]+)"/i,
        /search\s+for\s+"([^"]+)"/i,
        /look\s+for\s+"([^"]+)"/i,
        /find\s+([\w\s]+)/i,
        /search\s+for\s+([\w\s]+)/i,
        /look\s+for\s+([\w\s]+)/i
      ];

      for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match) return match[1].trim();
      }

      return input.replace(/\b(find|search|look)\b/gi, '').trim();
    }

    async function ensureFilesLoaded() {
      if (Object.keys(filesContentMap).length > 0) return;
      
      console.log("📁 Loading files on demand...");
      await preloadDriveFiles();
    }

    function speakResponse(text) {
      if (!synth) return;
      if (synth.speaking) synth.cancel();

      const spokenText = text
        .replace(/https:\/\/drive\.google\.com\/\S+/g, 'your Drive folder')
        .replace(/https:\/\/meet\.google\.com\/\S+/g, 'your meeting link')
        .replace(/https?:\/\/\S+/g, '[a link]')
        .replace(/<[^>]*>/g, '')
        .replace(/\*\*/g, '')
        .substring(0, 500); // Limit length for speech

      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = 'en-US';
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      
      synth.speak(utterance);
    }

    // Event listeners
    if (voiceReplyToggle) {
      voiceReplyToggle.addEventListener("change", () => {
        if (!voiceReplyToggle.checked && synth && synth.speaking) {
          synth.cancel();
        }
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener("click", () => {
        if (isProcessing || !chatInput.value.trim()) return;
        chatInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      });
    }

    if (micBtn) {
      micBtn.onclick = () => {
        if (!recognition) return;
        if (!isMicActive) {
          recognition.start();
        } else {
          recognition.stop();
        }
      };
    }

    window.addEventListener("beforeunload", () => {
      chrome.storage.local.remove("chatWindowId");
    });

    initSpeechRecognition();
  }).catch(error => {
    console.error("Failed to load AI helper:", error);
  });
});