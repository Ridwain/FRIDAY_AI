import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp, query, orderBy, getDocs, getDoc, doc, setDoc, updateDoc } from './firebase/firebase-firestore.js';


const RAG_CONFIG = {
  SERVER_URL: 'http://localhost:3000',
  OPENAI_API_KEY: '',
  MAX_RESULTS: 5,
  SIMILARITY_THRESHOLD: 0.7
};

let conversationHistory = [];
const MAX_CONVERSATION_HISTORY = 10;
const UPLOAD_TRACKER_KEY = 'ragUploadedFiles';
let uploadedFiles = new Set();

async function loadUploadedFilesList() {
  try {
    const result = await chrome.storage.local.get(UPLOAD_TRACKER_KEY);
    if (result[UPLOAD_TRACKER_KEY]) {
      uploadedFiles = new Set(result[UPLOAD_TRACKER_KEY]);
      console.log(`📦 Using cached file list with ${uploadedFiles.size} files`);
    } else {
      console.log('📦 No cached file list found');
    }
  } catch (error) {
    console.error('Error loading uploaded files list:', error);
  }
}

async function saveUploadedFilesList() {
  try {
    await chrome.storage.local.set({ [UPLOAD_TRACKER_KEY]: [...uploadedFiles] });
    console.log(`✅ Updated cached file list with ${uploadedFiles.size} files`);
  } catch (error) {
    console.error('Error saving uploaded files list:', error);
  }
}

function normalizeFilename(name) {
  return name.trim().toLowerCase().replace(/[^\w\s.-]/g, '');
}

document.addEventListener("DOMContentLoaded", () => {
  // Initialize Speech Recognition
  function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn("Speech Recognition not supported in this browser.");
    if (micBtn) {
      micBtn.disabled = true;
      micBtn.title = "Speech Recognition not supported in this browser";
      micBtn.style.opacity = "0.5";
    }
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    console.log("🎤 Speech recognition started");
    isMicActive = true;
    if (micBtn) {
      micBtn.textContent = '🔴';
      micBtn.style.color = 'red';
      micBtn.style.animation = 'pulse 1s infinite';
      micBtn.title = 'Listening... Click to stop';
    }
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    console.log("🎤 Speech recognized:", transcript);
    
    if (chatInput && transcript) {
      chatInput.value = transcript;
      // Automatically send the message
      setTimeout(() => {
        if (!isProcessing) {
          chatInput.dispatchEvent(new KeyboardEvent("keydown", { 
            key: "Enter",
            bubbles: true,
            cancelable: true
          }));
        }
      }, 100);
    }
  };

  recognition.onend = () => {
    console.log("🎤 Speech recognition ended");
    isMicActive = false;
    if (micBtn) {
      micBtn.textContent = '🎤';
      micBtn.style.color = '';
      micBtn.style.animation = '';
      micBtn.title = 'Click to speak your question';
    }
  };

  recognition.onerror = (event) => {
    console.error("🎤 Speech recognition error:", event.error);
    isMicActive = false;
    
    if (micBtn) {
      micBtn.textContent = '🎤';
      micBtn.style.color = '';
      micBtn.style.animation = '';
      micBtn.title = 'Speech recognition error. Click to try again.';
    }

    // Show user-friendly error messages
    let errorMessage = "Voice input error: ";
    switch(event.error) {
      case 'no-speech':
        errorMessage += "No speech detected. Please try again.";
        break;
      case 'audio-capture':
        errorMessage += "Microphone not available. Please check permissions.";
        break;
      case 'not-allowed':
        errorMessage += "Microphone access denied. Please allow microphone access.";
        break;
      case 'network':
        errorMessage += "Network error. Please check your connection.";
        break;
      default:
        errorMessage += event.error;
    }
    
    // Show error in chat
    if (chatMessages) {
      const errorBubble = document.createElement("div");
      errorBubble.className = "chat-bubble ai-bubble error-bubble";
      errorBubble.innerHTML = `⚠️ ${errorMessage}`;
      errorBubble.style.backgroundColor = "#ffe6e6";
      errorBubble.style.borderLeft = "3px solid #ff4444";
      chatMessages.appendChild(errorBubble);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  };
}

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
      
      await setDoc(transcriptDocRef, {
        transcript: transcript,
        lastUpdated: lastUpdated,
        status: status,
        wordCount: transcript.trim().split(/\s+/).filter(word => word.length > 0).length
      }, { merge: true });
      
      console.log(`Updated transcript document: ${docId} (${transcript.length} chars)`);
    } catch (error) {
      console.error("Error updating transcript document:", error);
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
              
              await chrome.storage.local.remove(key);
              console.log(`Processed stored transcript: ${docId}`);
            }
          } else if (parts.length === 3) {
            const [, uid, meetingId] = parts;
            const transcript = allData[key];
            
            if (transcript && transcript.trim()) {
              const transcriptDocRef = doc(collection(db, "users", uid, "meetings", meetingId, "transcripts"));
              await setDoc(transcriptDocRef, { 
                content: transcript, 
                timestamp: serverTimestamp() 
              });
              
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

  // IMPROVED SEMANTIC SEARCH IMPLEMENTATION

  /**
   * Generate embeddings using OpenAI API
   */
  async function generateEmbedding(text) {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': ``
      },
      body: JSON.stringify({
        input: text.substring(0, 8000),
        model: 'text-embedding-3-small',
        dimensions: 1024
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}
  /**
   * Calculate cosine similarity between two vectors
   */
  function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  

  async function uploadChunksToPinecone(chunks, filename) {
  try {
    if (!chunks || chunks.length === 0) {
      console.warn('No chunks to upload for', filename);
      return;
    }

    console.log(`📤 Uploading ${chunks.length} chunks from ${filename} to Pinecone...`);

    // Prepare vectors in Pinecone format
    const vectors = chunks.map(chunk => ({
      id: chunk.id,
      values: chunk.embedding,
      metadata: {
        filename: chunk.filename,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content.substring(0, 1000), // Limit content size
        wordCount: chunk.content.split(/\s+/).length,
        uploadedAt: new Date().toISOString()
      }
    }));

    // Upload to Pinecone via your server
    const response = await fetch(`${EMBEDDING_CONFIG.SERVER_URL}/upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        namespace: 'meeting-assistant',
        vectors: vectors
      }),
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ Successfully uploaded ${result.upsertedCount || vectors.length} vectors from ${filename}`);
    
    return result;

  } catch (error) {
    console.error(`❌ Failed to upload chunks from ${filename}:`, error);
    // Don't throw - allow the process to continue with other files
  }
}


async function performRAGSearch(query, namespace) {
  try {
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) throw new Error('Failed to generate query embedding');

    // Build request body; include namespace only if provided
    const requestBody = {
      queryEmbedding,
      topK: RAG_CONFIG.MAX_RESULTS,
      includeMetadata: true
    };
    if (namespace) {
      requestBody.namespace = namespace;
    }

    const response = await fetch(`${RAG_CONFIG.SERVER_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    const results = await response.json();
    return results;
  } catch (error) {
    console.error('RAG search error:', error);
    return [];
  }
}


/**
 * Performs two searches: one in the meeting-specific namespace and one in the default.
 * Combines and sorts the results by similarity.
 */
async function performCombinedRAGSearch(query, meetingId) {
  const transcriptResults = await performRAGSearch(query, meetingId);
  const driveResults = await performRAGSearch(query); // default namespace
  const combined = [...transcriptResults, ...driveResults]
    .sort((a, b) => b.similarity - a.similarity);
  // Limit to the configured maximum
  return combined.slice(0, RAG_CONFIG.MAX_RESULTS);
}



async function processAndUploadDocuments(filesContentMap) {
  console.log("📤 Processing and uploading documents to vector database...");
  
  let uploadCount = 0;
  let skippedCount = 0;
  
  for (const [filename, content] of Object.entries(filesContentMap)) {
    const normalizedFilename = normalizeFilename(filename);
    
    // NEW CHECK: Skip if the file has already been uploaded
    if (uploadedFiles.has(normalizedFilename)) {
      console.log(`ℹ️ File "${filename}" already processed. Skipping upload.`);
      skippedCount++;
      continue;
    }
    
    if (!content || content.trim().length === 0) {
      console.log(`⚠️ File "${filename}" has no content. Skipping.`);
      continue;
    }
    
    try {
      console.log(`📤 Processing new file: ${filename}`);
      
      // Create chunks
      const chunks = createSimpleChunks(content, filename);
      
      // Generate embeddings and upload
      for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk.content);
        if (!embedding) continue;
        
        const vector = {
          id: chunk.id,
          values: embedding,
          metadata: {
            filename: chunk.filename,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content.substring(0, 1000),
            wordCount: chunk.content.split(/\s+/).length
          }
        };
        
        // Upload to Pinecone
        await fetch(`${RAG_CONFIG.SERVER_URL}/upsert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vectors: [vector] })
        });
        
        console.log(`✅ Uploaded chunk: ${chunk.id}`);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Mark the file as uploaded after successful processing
      uploadedFiles.add(normalizedFilename);
      await saveUploadedFilesList();
      uploadCount++;
      
    } catch (error) {
      console.error(`❌ Error processing ${filename}:`, error);
    }
  }
  
  console.log(`✅ Upload summary: ${uploadCount} new files uploaded, ${skippedCount} files skipped (already uploaded)`);
}

function createSimpleChunks(content, filename) {
  const chunkSize = 1000;
  const chunks = [];
  
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
          chunkIndex: chunkIndex
        });
        chunkIndex++;
      }
      currentChunk = paragraph;
    }
  }

  if (currentChunk) {
    chunks.push({
      id: `${filename}_chunk_${chunkIndex}`,
      content: currentChunk,
      filename: filename,
      chunkIndex: chunkIndex
    });
  }

  return chunks;
}
  /**
   * Perform semantic search using backend server - FIXED VERSION
   */
  async function performSemanticSearch(query, documentChunks) {
    try {
      console.log(`🔍 Performing semantic search for: "${query}"`);
      
      // Generate query embedding first
      const queryEmbedding = await generateEmbedding(query);
      if (!queryEmbedding) {
        console.warn('Could not generate query embedding, falling back to keyword search');
        return [];
      }
      
      // Option 1: Use backend server if available
      try {
        const response = await fetch(`${EMBEDDING_CONFIG.SERVER_URL}/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            queryEmbedding: queryEmbedding,
            topK: EMBEDDING_CONFIG.MAX_DOCUMENTS_FOR_CONTEXT
          })
        });

        if (response.ok) {
          const serverResults = await response.json();
          console.log(`🎯 Backend search returned ${serverResults.length} results`);
          return serverResults;
        }
      } catch (fetchError) {
        console.warn('Backend server unavailable, using local search:', fetchError.message);
      }
      
      // Option 2: Local semantic search fallback
      console.log('🔄 Performing local semantic search...');
      
      if (!documentChunks || documentChunks.length === 0) {
        console.warn('No document chunks available for local search');
        return [];
      }
      
      const results = documentChunks
        .map(chunk => {
          if (!chunk.embedding) return null;
          
          const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
          return {
            id: chunk.id,
            filename: chunk.filename,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            similarity: similarity,
            score: similarity * 100 // Convert to percentage
          };
        })
        .filter(result => result && result.similarity >= EMBEDDING_CONFIG.SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, EMBEDDING_CONFIG.MAX_DOCUMENTS_FOR_CONTEXT);

      console.log(`✅ Local search found ${results.length} relevant chunks`);
      return results;
      
    } catch (error) {
      console.error('Error in semantic search:', error);
      return [];
    }
  }

 
  

  /**
   * Merge different types of search results
   */
  
  /**
   * Build context for AI from search results
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

  // Continue with the rest of your existing code...
  // [The rest of your functions remain the same]
  
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
        
        let score = 0;
        let matchedPhrases = [];
        
        if (transcriptLower.includes(queryLower)) {
          score += 10;
          matchedPhrases.push(queryLower);
        }
        
        queryWords.forEach(word => {
          const wordCount = (transcriptLower.match(new RegExp(word, 'g')) || []).length;
          score += wordCount * 2;
          if (wordCount > 0) matchedPhrases.push(word);
        });
        
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

  function cleanTextForSpeech(text) {
    return text
      // Remove URLs and replace with descriptive text
      .replace(/https:\/\/drive\.google\.com\/\S+/g, 'your Drive folder')
      .replace(/https:\/\/meet\.google\.com\/\S+/g, 'your meeting link')
      .replace(/https?:\/\/\S+/g, 'a link')
      
      // Remove HTML tags
      .replace(/<[^>]*>/g, '')
      
      // Remove markdown formatting
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      
      // Remove special characters that don't speak well
      .replace(/[📁📄🔍✅❌⚠️🎯📝🔄💡]/g, '')
      
      // Replace common symbols
      .replace(/&amp;/g, 'and')
      .replace(/&lt;/g, 'less than')
      .replace(/&gt;/g, 'greater greater than')
      
      // Limit length for better speech
      .substring(0, 800)
      
      // Clean up extra spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Rest of your existing functions...
  
// Enhanced analyzeQuestionIntent function
function analyzeQuestionIntent(query) {
  const queryLower = query.toLowerCase();
  
  // Check for explicit file extensions
  if (/\.(pptx|docx?|pdf|txt|csv|md)$/i.test(queryLower)) return 'file_content';

  const patterns = {
    drive_files: [
      // More comprehensive Drive file patterns
      /\b(show|give|list|display|find|what).*\b(files?|documents?|drive|folder)\b/i,
      /\bfiles? in\b.*\b(drive|folder)\b/i,
      /\bwhat.*inside.*drive\b/i,
      /\blist.*documents?\b/i,
      /\bshow.*folder\b/i,
      /\bdrive folder\b/i,
      /\ball.*files?\b/i,
      /\bavailable.*files?\b/i,
      /\bfiles?.*uploaded\b/i,
      /\buploaded.*files?\b/i,
      /^what files/i,
      /^which files/i,
      /^any files/i,
      /^files in/i,
      /^documents in/i,
      /\bfolder.*contents?\b/i,
      /\bcontents?.*of.*folder\b/i,
      /\bdrive.*contents?\b/i
    ],
    
    file_content: [
      /\b(?:_?[A-Za-z0-9\s-]+\.docx?)\b/i,
      /\b(?:_?[A-Za-z0-9\s-]+\.txt|\.csv|\.md|\.pdf|\.pptx)\b/i,
      /\bread.*file/i,
      /\bopen.*file/i,
      /\bshow.*file/i,
      /\bextract.*from.*file/i,
      /\bwhat.*(?:inside|in|from).*file/i,
      /\bfile.*contains?\b/i,
      /\bcontents? of\b.*file/i,
      /\bdata.*in.*file/i,
      /\binfo.*from.*file/i
    ],

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
    
    search_files: [
      /\bsearch.*in.*files?\b/i,
      /\bfind.*in.*documents?\b/i,
      /\blook.*for.*in.*drive\b/i,
      /\bsearch.*drive.*for\b/i
    ],
    
    file_search: [
      /\bsearch\b.*\bfor\b/i,
      /\bfind\b.*\bfile/i,
      /\blook.*for\b/i
    ]
  };
  
  for (const [intent, regexArray] of Object.entries(patterns)) {
    if (regexArray.some(regex => regex.test(queryLower))) {
      console.log(`🎯 Intent detected: ${intent} for query: "${queryLower}"`);
      return intent;
    }
  }
  
  console.log(`🎯 Intent detected: general for query: "${queryLower}"`);
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

  function needsTranscriptSearch(query) {
    const intent = analyzeQuestionIntent(query);
    return intent === 'meeting_transcript';
  }

  function needsDriveAccess(query) {
    const intent = analyzeQuestionIntent(query);
    return ['drive_files', 'file_content', 'search_files', 'file_search'].includes(intent);
  }

  

  

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

// ENHANCED AI RESPONSE FUNCTION WITH INTELLIGENT SOURCE PRIORITIZATION
async function getRAGResponseWithContext(input, selectedMeeting, userUid, filesContentMap, getAIResponse) {
  console.log(`🤖 Processing RAG query with context: ${input}`);
  
  let context = "";
  let searchResults = [];
  let sourceInfo = "";
  
  // 1. Analyze user intent and explicit source mentions
  const sourceIntent = analyzeSourceIntent(input);
  console.log(`🎯 Detected source intent: ${sourceIntent.type}`);
  
  if (sourceIntent.type === 'transcript_only') {
    // 2A. User explicitly mentioned transcript/meeting - ONLY search transcripts
    console.log("📝 User explicitly requested transcript information");
    
    try {
      const transcriptResults = await performRAGSearch(input, selectedMeeting?.meetingId);
      
      if (transcriptResults.length > 0) {
        context = "MEETING TRANSCRIPT CONTEXT:\n\n";
        transcriptResults.forEach((result, index) => {
          context += `Transcript Segment ${index + 1}:\n`;
          context += `Relevance: ${result.similarity.toFixed(3)}\n`;
          context += `Content: "${result.content}"\n\n`;
        });
        searchResults = transcriptResults;
        sourceInfo = "Sources: Meeting Transcript";
      } else {
        // Fallback to full transcript
        const transcript = await loadTranscript(userUid, selectedMeeting.meetingId);
        if (transcript && transcript.length > 0) {
          context = `MEETING TRANSCRIPT:\n${transcript.substring(0, 4000)}...\n\n`;
          sourceInfo = "Sources: Meeting Transcript (Full)";
        }
      }
    } catch (error) {
      console.warn("Could not load transcript:", error);
      context = "⚠️ Could not access meeting transcript.\n\n";
    }
    
  } else if (sourceIntent.type === 'files_only') {
    // 2B. User explicitly mentioned files/drive - ONLY search documents
    console.log("📁 User explicitly requested file information");
    
    const documentResults = await performRAGSearch(input); // default namespace for documents
    if (documentResults.length > 0) {
      context = "GOOGLE DRIVE FILES CONTEXT:\n\n";
      documentResults.forEach((result, index) => {
        context += `Document ${index + 1}: ${result.filename}\n`;
        context += `Relevance: ${result.similarity.toFixed(3)}\n`;
        context += `Content: "${result.content}"\n\n`;
      });
      searchResults = documentResults;
      sourceInfo = "Sources: Google Drive Files";
    } else {
      context = "⚠️ No relevant information found in Drive files.\n\n";
      sourceInfo = "Sources: Google Drive Files (No matches)";
    }
    
  } else {
    // 2C. No explicit source mentioned - search BOTH, transcript first
    console.log("🔍 No explicit source mentioned, searching both transcript and files");
    
    let transcriptResults = [];
    let documentResults = [];
    
    try {
      // Search transcript first
      if (selectedMeeting?.meetingId) {
        transcriptResults = await performRAGSearch(input, selectedMeeting.meetingId);
        
        if (transcriptResults.length === 0) {
          // Fallback to full transcript for important queries
          const transcript = await loadTranscript(userUid, selectedMeeting.meetingId);
          if (transcript && transcript.length > 0) {
            // Create a pseudo-result for display consistency
            transcriptResults = [{
              content: transcript.substring(0, 2000),
              similarity: 0.5,
              filename: "Meeting Transcript",
              source: "transcript"
            }];
          }
        }
      }
      
      // Search documents
      documentResults = await performRAGSearch(input); // default namespace
      
      // Build combined context
      if (transcriptResults.length > 0 || documentResults.length > 0) {
        context = "";
        let sources = [];
        
        if (transcriptResults.length > 0) {
          context += "MEETING TRANSCRIPT CONTEXT:\n\n";
          transcriptResults.forEach((result, index) => {
            context += `Transcript Segment ${index + 1}:\n`;
            context += `Content: "${result.content}"\n\n`;
          });
          sources.push("Meeting Transcript");
        }
        
        if (documentResults.length > 0) {
          context += "GOOGLE DRIVE FILES CONTEXT:\n\n";
          documentResults.forEach((result, index) => {
            context += `Document ${index + 1}: ${result.filename}\n`;
            context += `Content: "${result.content}"\n\n`;
          });
          sources.push("Google Drive Files");
        }
        
        searchResults = [...transcriptResults, ...documentResults];
        sourceInfo = `Sources: ${sources.join(" + ")}`;
      }
      
    } catch (error) {
      console.warn("Error in combined search:", error);
      context = "⚠️ Error accessing meeting data.\n\n";
      sourceInfo = "Sources: Error";
    }
  }
  
  // 3. Build conversation context
  let conversationContext = "";
  if (conversationHistory.length > 0) {
    conversationContext = "RECENT CONVERSATION:\n";
    const recentHistory = conversationHistory.slice(-6);
    recentHistory.forEach((msg, index) => {
      const role = msg.role === "user" ? "User" : "Assistant";
      conversationContext += `${role}: ${msg.content}\n`;
    });
    conversationContext += "\n";
  }
  
  // 4. Build enhanced system prompt with source awareness
  let systemPrompt = "";
  
  if (sourceIntent.type === 'transcript_only') {
    systemPrompt = `You are an intelligent meeting assistant. The user has specifically asked about the MEETING TRANSCRIPT only.

${conversationContext}${context}

CRITICAL INSTRUCTIONS:
- ONLY use information from MEETING TRANSCRIPT CONTEXT
- Do NOT reference any file or document information
- Do NOT use information from recent conversation unless it's about the transcript
- Focus entirely on what was discussed, decided, or mentioned in the meeting
- If no meeting transcript context is available, say "I don't have access to the meeting transcript"
- Provide comprehensive meeting summary when asked
- Quote specific parts from the transcript when relevant`;
  
  } else if (sourceIntent.type === 'files_only') {
    systemPrompt = `You are an intelligent assistant with access to Google Drive files. The user has specifically asked about DRIVE FILES only.

${conversationContext}${context}

CRITICAL INSTRUCTIONS:
- ONLY use information from GOOGLE DRIVE FILES CONTEXT
- Do NOT reference any meeting transcript information
- Focus on file contents, documents, and drive folder information
- If no file context is available, say "I don't have access to the requested files"
- Quote specific content from files when relevant`;
  
  } else {
    systemPrompt = `You are an intelligent meeting assistant with access to meeting transcripts and Google Drive documents.

${conversationContext}${context}

Instructions:
- Use the provided context AND conversation history to answer questions accurately
- For follow-up questions, refer to previous parts of our conversation
- When someone asks "What is his age?" or similar, look at recent conversation to understand who "his" refers to
- Use pronouns and references from the conversation context appropriately
- Quote specific content when relevant and mention the source
- For meeting summaries, provide comprehensive overview from transcript
- ALWAYS mention where information came from using the source info: "${sourceInfo}"
- If no relevant information found, clearly state this and suggest alternative approaches
- Be conversational and maintain context across multiple questions
- When providing information from both sources, clearly distinguish between transcript and file information`;
  }

  // 5. Prepare messages with conversation history
  const messages = [
    { role: "system", content: systemPrompt }
  ];
  
  const recentMessages = conversationHistory.slice(-4);
  messages.push(...recentMessages);
  messages.push({ role: "user", content: input });

  try {
    const aiReply = await getAIResponse(messages);
    return {
      response: aiReply,
      searchResults: searchResults,
      hasResults: searchResults.length > 0,
      sourceInfo: sourceInfo
    };
  } catch (error) {
    console.error("AI response error:", error);
    return {
      response: "Sorry, I'm having trouble processing your request.",
      searchResults: [],
      hasResults: false,
      sourceInfo: "Error"
    };
  }
}

// Helper function to analyze user's source intent
function analyzeSourceIntent(query) {
  const queryLower = query.toLowerCase();
  
  // Patterns for explicit transcript/meeting mentions (ENHANCED)
  const transcriptPatterns = [
    /\b(transcript|meeting transcript)\b/i,
    /\b(what.*discussed.*(?:in|during).*meeting)\b/i,
    /\b(what.*(?:is|was).*discussed.*(?:in|during).*meeting)\b/i,
    /\b(meeting.*summary|meeting.*recap|summarize.*meeting)\b/i,
    /\b(what.*happened.*(?:in|during).*meeting)\b/i,
    /\b(meeting.*about|meeting.*discussion)\b/i,
    /\b(from.*meeting|in.*meeting|during.*meeting)\b/i,
    /\b(conversation|call|session)\b/i,
    /\b(who.*said.*(?:in|during).*meeting)\b/i,
    /\b(what.*(?:talked|mentioned|said).*(?:in|during).*meeting)\b/i,
    /\b(action.*items?.*(?:from|in).*meeting)\b/i,
    /\b(decisions?.*(?:made|from).*meeting)\b/i,
    // Add more specific patterns
    /^what.*discussed.*meeting$/i, // "what is discussed in the meeting"
    /^what.*meeting.*about$/i,     // "what was the meeting about"
    /^meeting.*discussion$/i,       // "meeting discussion"
    /^give.*meeting.*summary$/i,    // "give me meeting summary"
  ];
  
  // Patterns for explicit file/drive mentions
  const filePatterns = [
    /\b(file|files|document|documents|google drive)\b/i,
    /\b(\.pdf|\.docx|\.txt|\.csv|\.pptx|\.doc)\b/i,
    /\b(from.*file|in.*file|file.*contains|file.*says)\b/i,
    /\b(drive.*folder|folder|uploaded|drive)\b/i,
    /\b([a-zA-Z0-9_-]+\.(pdf|docx|txt|csv|pptx|doc))\b/i, // specific file names
    /\b(what.*(?:in|inside).*file)\b/i,
    /\b(show.*file|open.*file|read.*file)\b/i,
  ];
  
  // Check for explicit mentions
  const mentionsTranscript = transcriptPatterns.some(pattern => pattern.test(queryLower));
  const mentionsFiles = filePatterns.some(pattern => pattern.test(queryLower));
  
  console.log(`🔍 Query analysis: "${queryLower}"`);
  console.log(`📝 Mentions transcript: ${mentionsTranscript}`);
  console.log(`📁 Mentions files: ${mentionsFiles}`);
  
  if (mentionsTranscript && !mentionsFiles) {
    console.log(`✅ Classified as: transcript_only`);
    return { type: 'transcript_only', confidence: 'high' };
  } else if (mentionsFiles && !mentionsTranscript) {
    console.log(`✅ Classified as: files_only`);
    return { type: 'files_only', confidence: 'high' };
  } else if (mentionsTranscript && mentionsFiles) {
    console.log(`✅ Classified as: both_mentioned`);
    return { type: 'both_mentioned', confidence: 'medium' };
  } else {
    console.log(`✅ Classified as: search_both (no explicit mention)`);
    return { type: 'search_both', confidence: 'low' };
  }
}

// Helper function to build document context (simplified)
function buildDocumentContext(ragResults) {
  let context = "RELEVANT DOCUMENTS:\n\n";
  ragResults.forEach((result, index) => {
    context += `Document ${index + 1}: ${result.filename}\n`;
    context += `Relevance: ${result.similarity.toFixed(3)}\n`;
    context += `Content: "${result.content}"\n\n`;
  });
  return context;
}

  function highlightSearchTerms(text, searchTerms) {
    if (!searchTerms || searchTerms.length === 0) return text;

    let highlightedText = text;

    searchTerms.forEach(term => {
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\      meeting_transcript');
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

  // ENHANCED DRIVE FUNCTIONS
  async function verifyFolderAccess(folderId, token) {
    try {
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

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    if (isNaN(bytes)) return 'Unknown size';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async function listFilesInFolder(folderId, token) {
    const files = [];

    async function recurse(folderId, path = "") {
      try {
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
          if (file.trashed === true) {
            console.log(`Skipping trashed file: ${file.name}`);
            continue;
          }

          const fullPath = path ? `${path}/${file.name}` : file.name;
          
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            console.log(`📂 Entering subfolder: ${fullPath}`);
            await recurse(file.id, fullPath);
          } else {
            if (file.id && file.name) {
              files.push({
                ...file,
                path: fullPath,
                displaySize: file.size ? formatFileSize(parseInt(file.size)) : 'Unknown size'
              });
              console.log(`📄 Added file: ${file.name} (${file.displaySize})`);
            }
          }
        }
      } catch (error) {
        console.error(`Error accessing folder ${folderId}:`, error);
      }
    }

    await recurse(folderId);
    console.log(`✅ Total files collected: ${files.length}`);
    return files;
  }

  async function getFreshFileList(folderId, token, forceRefresh = false) {
    const cacheKey = `drive_files_${folderId}`;
    const cacheTimeKey = `drive_files_time_${folderId}`;
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    try {
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
      
      await verifyFolderAccess(folderId, token);
      const files = await listFilesInFolder(folderId, token);
      
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

  // Continue with the rest of the Drive functions and chat interface...
  // [Rest of your existing code for file downloading, chat interface, etc.]

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
    conversationHistory = [];
    
    const snapshot = await getDocs(q);
    snapshot.forEach(doc => {
      const { role, content } = doc.data();
      
      conversationHistory.push({ role, content });
      
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${role === "user" ? "user-bubble" : "ai-bubble"}`;
      bubble.innerHTML = linkify(content);
      chatMessages.appendChild(bubble);
    });
    
    if (conversationHistory.length > MAX_CONVERSATION_HISTORY * 2) {
      conversationHistory = conversationHistory.slice(-MAX_CONVERSATION_HISTORY * 2);
    }
    
    // ✅ FIXED: Scroll after loading history
    scrollToBottom(true);
    console.log(`📚 Loaded ${conversationHistory.length} messages into conversation context`);
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

  function scrollToBottom(forceScroll = false) {
  if (!chatMessages) return;
  
  // Use requestAnimationFrame to ensure DOM has updated
  requestAnimationFrame(() => {
    // Double RAF for better reliability with dynamic content
    requestAnimationFrame(() => {
      const isNearBottom = chatMessages.scrollTop + chatMessages.clientHeight >= chatMessages.scrollHeight - 50;
      
      // Always scroll for new messages, or if user was already near bottom
      if (forceScroll || isNearBottom) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
        console.log(`📜 Scrolled to bottom: ${chatMessages.scrollHeight}`);
      }
    });
  });
}

  // Main chat interface initialization
  import('./enhanced-ai-helper.js').then(({ getAIResponse }) => {
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
  if (!selectedMeeting?.driveFolderLink) return;
  
  const folderId = extractFolderId(selectedMeeting.driveFolderLink);
  if (!folderId) return;

  try {
    console.log("🔄 Loading Drive files...");
    
    // Load the uploaded files list first
    await loadUploadedFilesList();
    
    const token = await getAuthToken();
    const files = await getFreshFileList(folderId, token);

    const supportedFiles = files.filter(f =>
      f.mimeType === "text/plain" ||
      f.mimeType === "application/vnd.google-apps.document" ||
      f.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      f.mimeType === "application/pdf" ||
      f.mimeType === "text/csv" ||
      f.mimeType === "application/vnd.google-apps.spreadsheet" ||
      f.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" // ✅ PPTX support
    );

    console.log(`📂 Found ${supportedFiles.length} supported files in Drive`);
    console.log(`📦 Already processed files: ${Array.from(uploadedFiles).join(', ')}`);

    // Load content only for files that haven't been uploaded yet
    const filesToProcess = {};
    let newFilesCount = 0;
    
    for (const file of supportedFiles.slice(0, 10)) {
      if (file.size && parseInt(file.size) >= 5000000) continue;

      const normalizedFilename = normalizeFilename(file.name);
      
      // Skip if already uploaded
      if (uploadedFiles.has(normalizedFilename)) {
        console.log(`⏭️ Skipping already processed file: ${file.name}`);
        continue;
      }

      try {
        console.log(`📖 Loading new file: ${file.name}`);
        const content = await downloadFileContent(file, token);
        if (content && content.trim().length > 0) {
          filesToProcess[file.name.toLowerCase()] = content;
          filesContentMap[file.name.toLowerCase()] = content; // Keep for local search
          newFilesCount++;
        }
      } catch (error) {
        console.warn(`Failed to load ${file.name}:`, error);
      }
    }

    // Only upload if there are new files to process
    if (Object.keys(filesToProcess).length > 0) {
      console.log(`📤 Uploading ${Object.keys(filesToProcess).length} new files to vector database...`);
      await processAndUploadDocuments(filesToProcess);
    } else {
      console.log(`✅ All files already processed. RAG system ready with ${uploadedFiles.size} documents`);
    }
    
  } catch (error) {
    console.warn("Failed to setup RAG system:", error);
  }
}

// Enhanced chat input handler with semantic search
// Enhanced chat input handler with proper Drive file routing
chatInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter" || isProcessing) return;
  isProcessing = true;

  const input = chatInput.value.trim();
  if (!input) {
    isProcessing = false;
    return;
  }

  chatInput.value = "";

  // Add user message to conversation history
  conversationHistory.push({ role: "user", content: input });

  // Add user message to UI
  const userBubble = document.createElement("div");
  userBubble.className = "chat-bubble user-bubble";
  userBubble.textContent = input;
  chatMessages.appendChild(userBubble);
  
  // ✅ FIXED: Scroll after user message with force
  scrollToBottom(true);

  // Add AI thinking bubble
  const aiBubble = document.createElement("div");
  aiBubble.className = "chat-bubble ai-bubble";
  aiBubble.innerHTML = '<div class="typing-indicator">🔍 Processing your request...</div>';
  chatMessages.appendChild(aiBubble);
  
  // ✅ FIXED: Scroll after AI thinking bubble
  scrollToBottom(true);

  try {
    // ... your existing logic for handling different query types ...
    
    const intent = analyzeQuestionIntent(input);
    console.log(`🎯 Detected intent: ${intent}`);

    if (intent === 'drive_files' || isDriveFileListRequest(input)) {
      await handleDriveFilesQuery(input, aiBubble);
    } else if (intent === 'file_search' || intent === 'search_files') {
      await handleFileSearchQuery(input, aiBubble);
    } else {
      aiBubble.innerHTML = '<div class="typing-indicator">🔍 Searching knowledge base...</div>';
      const ragResponse = await getRAGResponseWithContext(input, selectedMeeting, userUid, filesContentMap, getAIResponse);
      
      conversationHistory.push({ role: "assistant", content: ragResponse.response });
      
      if (conversationHistory.length > MAX_CONVERSATION_HISTORY * 2) {
        conversationHistory = conversationHistory.slice(-MAX_CONVERSATION_HISTORY * 2);
      }
      
      aiBubble.innerHTML = linkify(ragResponse.response);
      
      if (ragResponse.hasResults) {
        const contextInfo = document.createElement("div");
        contextInfo.style.cssText = "font-size: 0.8em; color: #666; margin-top: 8px; font-style: italic;";
        contextInfo.innerHTML = `✨ Found ${ragResponse.searchResults.length} relevant documents`;
        aiBubble.appendChild(contextInfo);
      }

      if (voiceReplyToggle && voiceReplyToggle.checked && synth) {
        console.log("🔊 Voice reply enabled, speaking response");
        setTimeout(() => {
          speakResponse(ragResponse.response || aiBubble.textContent);
        }, 500);
      }
    }

    // Save to chat history in Firebase (for all response types)
    if (userUid && selectedMeeting?.meetingId) {
      const responseText = aiBubble.textContent || aiBubble.innerText;
      saveChatMessage(userUid, selectedMeeting.meetingId, "user", input);
      saveChatMessage(userUid, selectedMeeting.meetingId, "assistant", responseText);
    }

  } catch (error) {
    console.error("Chat error:", error);
    aiBubble.innerHTML = "⚠️ Sorry, I encountered an error. Please try again.";
  }

  isProcessing = false;
  
  // ✅ FIXED: Final scroll after everything is complete
  scrollToBottom(true);
});


function isDriveFileListRequest(query) {
  const queryLower = query.toLowerCase().trim();
  
  // More comprehensive patterns for Drive file requests
  const driveFilePatterns = [
    // Direct file listing requests
    /^(show|list|display|give me).*files?$/i,
    /^(show|list|display|give me).*documents?$/i,
    /^(show|list|display|give me).*drive.*files?$/i,
    /^what.*files?.*(do|are).*in.*(drive|folder)$/i,
    /^what.*documents?.*(do|are).*in.*(drive|folder)$/i,
    
    // More natural language patterns
    /\b(show|give|list|display|find|what).*\b(files?|documents?|drive)\b/i,
    /\bfiles? in\b.*\b(drive|folder)\b/i,
    /\bwhat.*inside.*drive\b/i,
    /\blist.*documents?\b/i,
    /\bshow.*folder\b/i,
    /\bdrive folder.*contents?\b/i,
    /\ball.*files?\b/i,
    /\bavailable.*files?\b/i,
    /\bfiles?.*uploaded\b/i,
    /\bfiles?.*available\b/i,
    
    // Question patterns
    /^what files/i,
    /^which files/i,
    /^any files/i,
    /^all files/i,
    /files in drive/i,
    /documents in folder/i
  ];
  
  const isDriveRequest = driveFilePatterns.some(pattern => pattern.test(queryLower));
  console.log(`🔍 Drive file request check: "${queryLower}" -> ${isDriveRequest}`);
  
  return isDriveRequest;
}



// Enhanced handleDriveFilesQuery function with proper error handling and fresh data
async function handleDriveFilesQuery(input, aiBubble) {
  console.log("📁 Handling Drive files query:", input);
  
  if (!selectedMeeting?.driveFolderLink) {
    aiBubble.innerHTML = "⚠️ No Drive folder linked to this meeting. Please add a Drive folder link in the meeting settings.";
    return;
  }

  const folderId = extractFolderId(selectedMeeting.driveFolderLink);
  if (!folderId) {
    aiBubble.innerHTML = "⚠️ Could not extract folder ID from Drive link. Please check the folder link format.";
    return;
  }

  try {
    aiBubble.innerHTML = '<div class="typing-indicator">📁 Accessing your Drive folder (checking for new files)...</div>';
    
    // Get fresh auth token
    const token = await getAuthToken();
    console.log("✅ Got auth token");
    
    // ALWAYS force refresh to check for new files
    console.log("🔄 Force refreshing Drive folder to check for new files...");
    const files = await getFreshFileList(folderId, token, true); // Force refresh = true
    
    console.log(`📂 Found ${files.length} total files`);

    if (files.length === 0) {
      aiBubble.innerHTML = `📂 Your Drive folder appears to be empty or contains no accessible files.<br><br>
        <strong>Folder:</strong> <a href="${selectedMeeting.driveFolderLink}" target="_blank" rel="noopener noreferrer">Open in Google Drive</a><br><br>
        <em>If you just added files, they should appear now. If not, please check folder permissions.</em>`;
      return;
    }

    // Group files by type for better organization
    const filesByType = {};
    files.forEach(file => {
      const type = getFileTypeCategory(file.mimeType);
      if (!filesByType[type]) filesByType[type] = [];
      filesByType[type].push(file);
    });

    // Build comprehensive response
    let response = `📁 <strong>Your Drive Folder Contents (${files.length} files)</strong><br><br>`;
    
    // Add timestamp to show freshness
    response += `<small>🕐 <em>Refreshed: ${new Date().toLocaleString()}</em></small><br><br>`;
    
    // List files by category
    for (const [type, typeFiles] of Object.entries(filesByType)) {
      response += `<strong>${type} (${typeFiles.length}):</strong><br>`;
      
      typeFiles.forEach((file, index) => {
        const sizeDisplay = file.displaySize || 'Unknown size';
        const modifiedDate = file.modifiedTime ? 
          new Date(file.modifiedTime).toLocaleDateString() : '';
        const dateStr = modifiedDate ? ` • Modified: ${modifiedDate}` : '';
        
        response += `${index + 1}. <a href="${file.webViewLink}" target="_blank" rel="noopener noreferrer">${file.name}</a> <small>(${sizeDisplay}${dateStr})</small><br>`;
      });
      response += '<br>';
    }

    // Add helpful footer
    response += `<hr style="margin: 15px 0; border: none; border-top: 1px solid #eee;">`;
    response += `<small>💡 <strong>Tip:</strong> You can ask me about specific files or search within their content!</small><br>`;
    response += `<small>🔗 <a href="${selectedMeeting.driveFolderLink}" target="_blank" rel="noopener noreferrer">Open folder in Google Drive</a></small>`;

    aiBubble.innerHTML = response;
    console.log("✅ Successfully displayed Drive files");
    scrollToBottom(true);

  } catch (err) {
    console.error("Drive API error:", err);
    
    let errorResponse = "";
    if (err && (err.status === 403 || err.message.includes('403'))) {
      errorResponse = `⚠️ <strong>Access Denied to Drive Folder</strong><br><br>
        This could mean:<br>
        • You don't have permission to view this folder<br>
        • The folder has been moved or deleted<br>
        • The sharing settings have changed<br>
        • Your authentication has expired<br><br>
        <strong>Try these solutions:</strong><br>
        1. <a href="${selectedMeeting.driveFolderLink}" target="_blank" rel="noopener noreferrer">Open the folder directly in Google Drive</a><br>
        2. Refresh this page to re-authenticate<br>
        3. Check that the folder is shared with your account<br><br>
        <small><em>Error: ${err.message}</em></small>`;
    } else if (err && (err.status === 404 || err.message.includes('404'))) {
      errorResponse = `⚠️ <strong>Drive Folder Not Found</strong><br><br>
        The linked Drive folder could not be found.<br><br>
        Possible reasons:<br>
        • The folder was deleted or moved<br>
        • The folder ID in the link is incorrect<br>
        • You don't have access to this folder<br><br>
        <a href="${selectedMeeting.driveFolderLink}" target="_blank" rel="noopener noreferrer">Try opening the folder link</a>`;
    } else {
      errorResponse = `❌ <strong>Error Accessing Google Drive</strong><br><br>
        <strong>Error:</strong> ${err.message}<br><br>
        <strong>Please try:</strong><br>
        • Refreshing your browser<br>
        • Re-authorizing the extension<br>
        • Checking your internet connection<br><br>
        <a href="${selectedMeeting.driveFolderLink}" target="_blank" rel="noopener noreferrer">Open folder in Google Drive</a>`;
    }
    
    aiBubble.innerHTML = errorResponse;
    scrollToBottom(true);
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
  if (!synth) {
    console.warn("Speech synthesis not available");
    return;
  }

  // Cancel any ongoing speech
  if (synth.speaking) {
    synth.cancel();
  }

  // Clean text for speech
  const cleanText = cleanTextForSpeech(text);
  
  if (!cleanText || cleanText.length === 0) {
    console.warn("No text to speak");
    return;
  }

  console.log("🔊 Speaking:", cleanText.substring(0, 50) + "...");

  const utterance = new SpeechSynthesisUtterance(cleanText);
  
  // Voice settings
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 0.8;

  // Try to use a good voice
  const voices = synth.getVoices();
  const preferredVoice = voices.find(voice => 
    voice.lang.includes('en') && 
    (voice.name.includes('Google') || voice.name.includes('Microsoft'))
  ) || voices.find(voice => voice.lang.includes('en'));
  
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  // Event handlers
  utterance.onstart = () => {
    console.log("🔊 Started speaking");
    if (voiceReplyToggle) {
      voiceReplyToggle.style.color = '#4CAF50';
      voiceReplyToggle.style.animation = 'pulse 1s infinite';
    }
  };

  utterance.onend = () => {
    console.log("🔊 Finished speaking");
    if (voiceReplyToggle) {
      voiceReplyToggle.style.color = '';
      voiceReplyToggle.style.animation = '';
    }
  };

  // IMPROVED ERROR HANDLER - Don't log interruption as error
  utterance.onerror = (event) => {
    if (event.error === 'interrupted') {
      // This is expected when user turns off voice reply - don't show as error
      console.log("🔊 Speech interrupted by user");
    } else {
      // Only log actual errors
      console.error("🔊 Speech synthesis error:", event.error);
    }
    
    // Always reset visual indicators
    if (voiceReplyToggle) {
      voiceReplyToggle.style.color = '';
      voiceReplyToggle.style.animation = '';
    }
  };

  // ADDITIONAL: Add a check before speaking to ensure voice reply is still enabled
  if (voiceReplyToggle && !voiceReplyToggle.checked) {
    console.log("🔊 Voice reply disabled, not speaking");
    return;
  }

  // Speak the text
  synth.speak(utterance);
}

    // Event listeners
    if (voiceReplyToggle) {
  voiceReplyToggle.addEventListener("change", (e) => {
    console.log("🔊 Voice reply toggled:", e.target.checked);
    
if (!e.target.checked && synth && synth.speaking) {
      console.log("🔊 Stopping current speech due to toggle off");
      synth.cancel();
      
      // Reset visual indicators immediately
      if (voiceReplyToggle) {
        voiceReplyToggle.style.color = '';
        voiceReplyToggle.style.animation = '';
      }
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
  micBtn.onclick = (e) => {
    e.preventDefault();
    
    if (!recognition) {
      console.error("Speech recognition not initialized");
      return;
    }

    if (isMicActive) {
      // Stop recognition
      console.log("🎤 Stopping speech recognition");
      recognition.stop();
    } else {
      // Start recognition
      console.log("🎤 Starting speech recognition");
      try {
        recognition.start();
      } catch (error) {
        console.error("Failed to start speech recognition:", error);
        
        // Reset button state
        micBtn.textContent = '🎤';
        micBtn.style.color = '';
        micBtn.style.animation = '';
        micBtn.title = 'Speech recognition error. Click to try again.';
      }
    }
  };
}

    window.addEventListener("beforeunload", () => {
      chrome.storage.local.remove("chatWindowId");
    });

    function ensureVoicesLoaded() {
      if (synth && synth.getVoices().length === 0) {
        synth.addEventListener('voiceschanged', () => {
          console.log("🔊 Voices loaded:", synth.getVoices().length);
        });
      }
    }

    initSpeechRecognition();
    ensureVoicesLoaded();
  }).catch(error => {
    console.error("Failed to load AI helper:", error);
  });
});