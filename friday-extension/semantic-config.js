// semantic-config.js
export const SEMANTIC_CONFIG = {
  // OpenAI Configuration
  OPENAI_API_KEY: 'your-openai-api-key-here', // Replace with your actual API key
  EMBEDDING_MODEL: 'text-embedding-ada-002',
  EMBEDDING_DIMENSIONS: 1536,
  
  // Search Parameters
  SIMILARITY_THRESHOLD: 0.75, // Minimum similarity score (0-1)
  MAX_RESULTS: 5, // Maximum number of results to return
  CHUNK_SIZE: 1000, // Characters per document chunk
  CHUNK_OVERLAP: 200, // Overlap between chunks
  
  // Performance Settings
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // milliseconds
  RATE_LIMIT_DELAY: 200, // milliseconds between API calls
  CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  
  // UI Settings
  SHOW_PROGRESS: true,
  SHOW_SIMILARITY_SCORES: true,
  MAX_PREVIEW_LENGTH: 300,
  
  // Fallback Settings
  USE_LOCAL_FALLBACK: true,
  LOCAL_EMBEDDING_DIMENSIONS: 300
};

// Helper function to validate configuration
export function validateConfig(config = SEMANTIC_CONFIG) {
  const warnings = [];
  
  if (config.OPENAI_API_KEY === 'your-openai-api-key-here') {
    warnings.push('⚠️ OpenAI API key not configured - will use local fallback');
  }
  
  if (config.SIMILARITY_THRESHOLD < 0 || config.SIMILARITY_THRESHOLD > 1) {
    warnings.push('⚠️ Similarity threshold should be between 0 and 1');
  }
  
  if (config.CHUNK_SIZE < 100) {
    warnings.push('⚠️ Chunk size might be too small for meaningful embeddings');
  }
  
  if (warnings.length > 0) {
    console.warn('Semantic Search Configuration Issues:');
    warnings.forEach(warning => console.warn(warning));
  }
  
  return warnings.length === 0;
}