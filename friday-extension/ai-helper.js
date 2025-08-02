// 🚀 STEP-BY-STEP INTEGRATION WITH YOUR EXISTING CODE
// This enhances your current ai-helper.js with multiple free providers

// STEP 1: Add these free providers to your existing GROQ_CONFIG
const ENHANCED_PROVIDERS = {
  // Your existing Groq (keep as primary)
  GROQ: {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: '',
    models: {
      ultraFast: 'llama-3.1-8b-instant',  // NEW: Even faster!
      fast: 'llama3-8b-8192',
      balanced: 'llama3-70b-8192',
      creative: 'mixtral-8x7b-32768'
    },
    enabled: true,
    priority: 1
  },

  // Hugging Face - 100% FREE, no API key needed!
  HUGGING_FACE: {
    name: 'Hugging Face',
    url: 'https://api-inference.huggingface.co/models',
    key: null, // No key needed!
    models: {
      grammar: 'vennify/t5-base-grammar-correction',
      enhance: 'google/flan-t5-base',
      paraphrase: 'tuner007/pegasus_paraphrase'
    },
    enabled: true,
    priority: 2,
    free: true,
    setup: 'No setup needed - works immediately!'
  },

  // Cohere - FREE 100k requests/month
  COHERE: {
    name: 'Cohere',
    url: 'https://api.cohere.ai/v1/generate',
    key: 'mF5fWnpqGPbXrKtjxN5YlDh1vD4ph8kffY1d3yLl', // Get from dashboard.cohere.ai
    models: {
      generate: 'command-light-nightly'
    },
    enabled: false, // Enable after getting key
    priority: 3,
    free: true,
    setup: '1. Go to dashboard.cohere.ai\n2. Sign up (free)\n3. Get API key\n4. Replace COHERE_TRIAL_KEY_HERE'
  },

  // Together AI - $5 free credits monthly
  TOGETHER: {
    name: 'Together AI',
    url: 'https://api.together.xyz/v1/chat/completions',
    key: 'tgp_v1_oDTEzBfDtxOkNogtSMhrJIYfELexPs4KvpsSLyLJI2c', // Get from api.together.xyz
    models: {
      fast: 'meta-llama/Llama-2-7b-chat-hf',
      balanced: 'meta-llama/Llama-2-13b-chat-hf'
    },
    enabled: false, // Enable after getting key
    priority: 4,
    free: true,
    setup: '1. Go to api.together.xyz\n2. Sign up\n3. Get $5 free credits\n4. Replace TOGETHER_FREE_KEY_HERE'
  }
};

// STEP 2: Enhanced local corrections (works instantly, no API calls)
const SUPER_FAST_CORRECTIONS = {
  // Most common speech recognition errors
  instant: {
    // Contractions
    "cant": "can't", "wont": "won't", "dont": "don't", "isnt": "isn't",
    "wasnt": "wasn't", "werent": "weren't", "youre": "you're", "theyre": "they're",
    "its": "it's", "thats": "that's", "whats": "what's", "heres": "here's",
    
    // Technical terms (common in meetings)
    "a p i": "API", "jay son": "JSON", "sequel": "SQL", "git hub": "GitHub",
    "react js": "React.js", "node js": "Node.js", "type script": "TypeScript",
    "java script": "JavaScript", "my sequel": "MySQL", "post gres": "PostgreSQL",
    
    // Meeting terms
    "follow up": "follow-up", "action items": "action items", "next steps": "next steps",
    "touch base": "touch base", "sync up": "sync up", "stand up": "stand-up",
    
    // Common words
    "alot": "a lot", "seperate": "separate", "definately": "definitely",
    "recieve": "receive", "occured": "occurred", "neccessary": "necessary"
  },

  // Context-based replacements
  contextual: [
    // Homophones with context
    { find: /\bthere (going|gonna|thinking|planning)/gi, replace: "they're $1" },
    { find: /\byour (going|gonna|thinking|planning)/gi, replace: "you're $1" },
    { find: /\bits (going|gonna|working|running)/gi, replace: "it's $1" },
    
    // Grammar fixes
    { find: /\bi are\b/gi, replace: "I am" },
    { find: /\byou is\b/gi, replace: "you are" },
    { find: /\bhe are\b/gi, replace: "he is" },
    { find: /\bshe are\b/gi, replace: "she is" }
  ]
};

// STEP 3: Enhanced version of your existing functions
export class EnhancedAIHelper {
  constructor() {
    this.providers = ENHANCED_PROVIDERS;
    this.cache = new Map();
    this.failedProviders = new Set();
    this.requestCounts = {};
    
    // Initialize request counts
    Object.keys(this.providers).forEach(provider => {
      this.requestCounts[provider] = { count: 0, resetTime: Date.now() };
    });

    // Reset failed providers every 5 minutes
    setInterval(() => {
      this.failedProviders.clear();
      console.log('🔄 Reset failed providers');
    }, 5 * 60 * 1000);
  }

  // STEP 4: Enhanced version of your enhanceTranscript function
  async enhanceTranscript(transcript, options = {}) {
    if (!transcript || transcript.length < 50) {
      return transcript;
    }

    console.log(`📝 Enhancing transcript (${transcript.length} chars)...`);
    const startTime = Date.now();

    try {
      // Step 1: Apply instant local corrections (no API needed)
      let enhanced = this.applyInstantCorrections(transcript);
      console.log('✅ Applied local corrections');

      // Step 2: For very short text, local corrections might be enough
      if (enhanced.length < 300 && !options.forceAI) {
        console.log('⚡ Using local corrections only (fast path)');
        return this.finalizeText(enhanced);
      }

      // Step 3: Choose enhancement mode
      const mode = options.mode || (enhanced.length > 2000 ? 'balanced' : 'fast');
      
      // Step 4: Try AI enhancement with fallback
      enhanced = await this.tryAIEnhancement(enhanced, mode);
      
      const timeTaken = Date.now() - startTime;
      console.log(`✅ Enhanced in ${timeTaken}ms`);
      
      return this.finalizeText(enhanced);

    } catch (error) {
      console.error('❌ Enhancement failed:', error);
      // Fallback to local corrections
      return this.finalizeText(this.applyInstantCorrections(transcript));
    }
  }

  // STEP 5: Instant local corrections (works offline!)
  applyInstantCorrections(text) {
    let corrected = text;

    // Apply instant word replacements
    for (const [wrong, right] of Object.entries(SUPER_FAST_CORRECTIONS.instant)) {
      // Use word boundaries to avoid partial matches
      const regex = new RegExp(`\\b${wrong.replace(/\s+/g, '\\s+')}\\b`, 'gi');
      corrected = corrected.replace(regex, right);
    }

    // Apply contextual replacements
    for (const correction of SUPER_FAST_CORRECTIONS.contextual) {
      corrected = corrected.replace(correction.find, correction.replace);
    }

    // Clean up extra spaces
    corrected = corrected.replace(/\s+/g, ' ').trim();

    return corrected;
  }

  // STEP 6: Try AI enhancement with automatic fallback
  async tryAIEnhancement(text, mode = 'fast') {
    const providers = this.getAvailableProviders();
    
    if (providers.length === 0) {
      console.log('⚠️ No providers available, using local corrections only');
      return text;
    }

    for (const providerName of providers) {
      try {
        console.log(`🤖 Trying ${providerName}...`);
        const enhanced = await this.callProvider(providerName, text, mode);
        console.log(`✅ ${providerName} succeeded`);
        return enhanced;
      } catch (error) {
        console.log(`❌ ${providerName} failed: ${error.message}`);
        this.failedProviders.add(providerName);
        continue;
      }
    }

    // All providers failed, return original
    console.log('⚠️ All providers failed, using local corrections');
    return text;
  }

  getAvailableProviders() {
    return Object.entries(this.providers)
      .filter(([name, config]) => config.enabled && !this.failedProviders.has(name))
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([name]) => name);
  }

  async callProvider(providerName, text, mode) {
    const provider = this.providers[providerName];
    
    switch (providerName) {
      case 'GROQ':
        return await this.callGroq(text, mode);
      case 'HUGGING_FACE':
        return await this.callHuggingFace(text, mode);
      case 'COHERE':
        return await this.callCohere(text, mode);
      case 'TOGETHER':
        return await this.callTogether(text, mode);
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  // STEP 7: Your existing Groq function (enhanced)
  async callGroq(text, mode) {
    const provider = this.providers.GROQ;
    const model = mode === 'ultrafast' ? provider.models.ultraFast :
                  mode === 'fast' ? provider.models.fast :
                  provider.models.balanced;

    const messages = [
      {
        role: 'system',
        content: `You are a transcript enhancement expert. Fix speech recognition errors, add proper punctuation, correct grammar while preserving the speaker's natural voice and tone. Keep the same length. Return ONLY the corrected text, no explanations.`
      },
      {
        role: 'user',
        content: `Fix this transcript: "${text}"`
      }
    ];

    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.key}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: mode === 'ultrafast' ? 400 : mode === 'fast' ? 800 : 1200,
        temperature: 0.1,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  // STEP 8: Hugging Face (100% FREE - no setup needed!)
  async callHuggingFace(text, mode) {
    const provider = this.providers.HUGGING_FACE;
    const model = provider.models.grammar;

    const response = await fetch(`${provider.url}/${model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // No API key needed for public models!
      },
      body: JSON.stringify({
        inputs: `grammar: ${text}`,
        parameters: {
          max_new_tokens: mode === 'fast' ? 500 : 800,
          temperature: 0.1,
          do_sample: false
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Hugging Face error: ${response.status}`);
    }

    const data = await response.json();
    
    if (Array.isArray(data)) {
      return data[0].generated_text.replace('grammar: ', '').trim();
    } else if (data.generated_text) {
      return data.generated_text.replace('grammar: ', '').trim();
    } else {
      throw new Error('Invalid Hugging Face response format');
    }
  }

  // STEP 9: Cohere (free 100k requests/month)
  async callCohere(text, mode) {
    const provider = this.providers.COHERE;

    if (!provider.key || provider.key === 'COHERE_TRIAL_KEY_HERE') {
      throw new Error('Cohere API key not configured');
    }

    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.key}`
      },
      body: JSON.stringify({
        model: provider.models.generate,
        prompt: `Fix grammar and speech recognition errors in this transcript while keeping the natural conversational tone:\n\n"${text}"\n\nCorrected transcript:`,
        max_tokens: mode === 'fast' ? 400 : 800,
        temperature: 0.1,
        stop_sequences: ['\n\n', '"']
      })
    });

    if (!response.ok) {
      throw new Error(`Cohere error: ${response.status}`);
    }

    const data = await response.json();
    return data.generations[0].text.trim();
  }

  // STEP 10: Together AI (free $5 credits monthly)
  async callTogether(text, mode) {
    const provider = this.providers.TOGETHER;

    if (!provider.key || provider.key === 'TOGETHER_FREE_KEY_HERE') {
      throw new Error('Together AI key not configured');
    }

    const messages = [
      {
        role: 'system',
        content: 'You are a transcript editor. Fix speech recognition errors and improve grammar while preserving the natural speaking style.'
      },
      {
        role: 'user',
        content: `Please fix this transcript: "${text}"`
      }
    ];

    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.key}`
      },
      body: JSON.stringify({
        model: provider.models[mode === 'fast' ? 'fast' : 'balanced'],
        messages,
        max_tokens: mode === 'fast' ? 400 : 800,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`Together AI error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  finalizeText(text) {
    return text
      .replace(/\s+/g, ' ')  // Remove extra spaces
      .replace(/([.!?])\s*([a-z])/g, (match, punct, letter) => punct + ' ' + letter.toUpperCase()) // Capitalize after punctuation
      .trim();
  }

  // STEP 11: Enhanced version of your getAIResponse function
  async getAIResponse(messages, options = {}) {
    // Check cache first (your existing logic)
    const cacheKey = this.generateCacheKey(messages);
    const cached = this.getCachedResponse(cacheKey);
    if (cached && !options.bypassCache) {
      console.log('📋 Returning cached response');
      return cached;
    }

    // Try multiple providers with fallback
    const providers = this.getAvailableProviders();
    
    for (const providerName of providers) {
      try {
        const response = await this.callProviderForChat(providerName, messages, options);
        
        // Cache successful responses
        if (response && !response.includes('⚠️')) {
          this.setCachedResponse(cacheKey, response);
        }
        
        return response;
      } catch (error) {
        console.error(`${providerName} failed:`, error.message);
        this.failedProviders.add(providerName);
        continue;
      }
    }

    return "⚠️ All AI services temporarily unavailable. Please try again.";
  }

  async callProviderForChat(providerName, messages, options) {
    switch (providerName) {
      case 'GROQ':
        return await this.callGroqChat(messages, options);
      case 'HUGGING_FACE':
        // Hugging Face doesn't support chat format well, skip for now
        throw new Error('Hugging Face not suitable for chat');
      case 'COHERE':
        return await this.callCohereChat(messages, options);
      case 'TOGETHER':
        return await this.callTogetherChat(messages, options);
      default:
        throw new Error(`Provider ${providerName} not supported for chat`);
    }
  }

  async callGroqChat(messages, options) {
    // Your existing makeGroqRequest logic here
    const config = options.mode === 'fast' ? { model: 'llama3-8b-8192', maxTokens: 500 } :
                   { model: 'llama3-70b-8192', maxTokens: 1000 };

    const response = await fetch(this.providers.GROQ.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.providers.GROQ.key}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: this.optimizeMessages(messages),
        max_tokens: config.maxTokens,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`Groq chat error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  // Keep your existing helper functions
  generateCacheKey(messages) {
    const userMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
    const systemContext = messages.filter(m => m.role === 'system')[0]?.content.substring(0, 200) || '';
    return btoa(userMessage + systemContext).substring(0, 32);
  }

  getCachedResponse(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) { // 10 minutes
      return cached.response;
    }
    return null;
  }

  setCachedResponse(key, response) {
    this.cache.set(key, { response, timestamp: Date.now() });
  }

  optimizeMessages(messages) {
    // Your existing logic
    return messages.slice(-10);
  }
}

// STEP 12: Easy migration - replace your existing exports
const enhancedAI = new EnhancedAIHelper();

// Drop-in replacements for your existing functions
export async function enhanceTranscript(transcript, options = {}) {
  return await enhancedAI.enhanceTranscript(transcript, options);
}

export async function getAIResponse(messages, options = {}) {
  return await enhancedAI.getAIResponse(messages, options);
}

export async function getQuickResponse(query, context = '') {
  // Your existing simple queries logic
  const simpleQueries = {
    'hello': 'Hello! How can I help you with your meeting today?',
    'hi': 'Hi there! What would you like to know about your meeting?',
    'thanks': 'You\'re welcome! Is there anything else I can help you with?',
    'help': 'I can help you with meeting transcripts, file searches, and answering questions about your meeting content. What would you like to know?'
  };

  const lowerQuery = query.toLowerCase().trim();
  
  for (const [key, response] of Object.entries(simpleQueries)) {
    if (lowerQuery.includes(key)) {
      return response;
    }
  }

  return await enhancedAI.getAIResponse([
    { role: 'system', content: `You are a helpful meeting assistant. ${context}` },
    { role: 'user', content: query }
  ], { mode: 'fast' });
}

// STEP 13: New convenience functions
export function enableProvider(providerName, apiKey = null) {
  if (enhancedAI.providers[providerName]) {
    enhancedAI.providers[providerName].enabled = true;
    if (apiKey) {
      enhancedAI.providers[providerName].key = apiKey;
    }
    console.log(`✅ Enabled ${providerName}`);
  }
}

export function getProviderStatus() {
  const status = {};
  for (const [name, config] of Object.entries(enhancedAI.providers)) {
    status[name] = {
      enabled: config.enabled,
      needsKey: config.key && (config.key.includes('_HERE') || config.key === 'TRIAL_KEY'),
      setup: config.setup || 'Ready to use',
      failed: enhancedAI.failedProviders.has(name)
    };
  }
  return status;
}

// STEP 14: Usage examples
export const USAGE_EXAMPLES = {
  basic: `
// Basic usage (drop-in replacement)
const enhanced = await enhanceTranscript(transcript);
`,
  
  modes: `
// Different speed/accuracy modes
const ultraFast = await enhanceTranscript(transcript, { mode: 'ultrafast' });
const balanced = await enhanceTranscript(transcript, { mode: 'balanced' });
const accurate = await enhanceTranscript(transcript, { mode: 'accurate' });
`,
  
  setup: `
// Enable additional providers
enableProvider('COHERE', 'your_cohere_api_key');
enableProvider('TOGETHER', 'your_together_api_key');

// Check provider status
console.log(getProviderStatus());
`,
  
  realtime: `
// For real-time transcription
const enhancer = new EnhancedAIHelper();
const enhanced = await enhancer.enhanceTranscript(liveText, { mode: 'ultrafast' });
`
};

console.log('🚀 Enhanced AI Helper loaded! Check USAGE_EXAMPLES for implementation details.');