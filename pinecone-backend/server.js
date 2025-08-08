import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const port = 3000;


app.use(cors({
  origin: ['http://localhost:3000', 'chrome-extension://jmhghlacijdpjciifpobbfilakdickhb', '*'],
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.options('/search', cors());
app.options('/upsert', cors());
app.options('/delete', cors());

app.use(bodyParser.json({ limit: '50mb' }));

const PINECONE_CONFIG = {
  apiKey: 'pcsk_3UyAU4_DjATBcf1jUfGp7n3EFTFDDZqYYu1eQK8k8dky7J4QpkpBRVjk1P9D84iGDKX6yy',
  environment: 'us-east-1',
  indexName: 'meeting-assistant',
  baseUrl: 'https://llama-text-embed-v2-index-9rlp3c2.svc.aped-4627-b74a.pinecone.io'
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/upsert', async (req, res) => {
  console.log('📥 Received upsert request');

  try {
    const { namespace = 'meeting-assistant', vectors } = req.body;
    console.log('🔍 Namespace:', namespace);
    console.log('📦 Number of vectors:', vectors?.length);

    if (!Array.isArray(vectors) || vectors.length === 0) {
      console.log('❌ No vectors received in upsert');
      return res.status(400).json({ success: false, message: 'No vectors provided' });
    }

    console.log(`📤 Upserting ${vectors.length} vectors to Pinecone...`);

    const response = await fetch(`${PINECONE_CONFIG.baseUrl}/vectors/upsert`, {
      method: 'POST',
      headers: {
        'Api-Key': PINECONE_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        vectors,
        namespace
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pinecone upsert error:', response.status, errorText);
      throw new Error(`Pinecone upsert failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ Successfully upserted ${vectors.length} vectors`);

    res.json({
      success: true,
      upsertedCount: result.upsertedCount || vectors.length,
      message: 'Vectors successfully upserted to Pinecone'
    });

  } catch (error) {
    console.error('Error upserting to Pinecone:', error);
    res.status(500).json({
      error: 'Error upserting vectors to Pinecone',
      details: error.message
    });
  }
});

app.post('/search', async (req, res) => {
  // Add a default namespace to ensure searches go to the right place
  const { queryEmbedding, topK = 5, includeMetadata = true, namespace = 'meeting-assistant' } = req.body;
  
  if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
    return res.status(400).json({ error: 'Invalid query embedding' });
  }

  try {
    console.log(`🔍 Performing semantic search (topK: ${topK})...`);

    const searchPayload = {
      vector: queryEmbedding,
      topK: topK,
      includeMetadata: includeMetadata,
      includeValues: false
    };

    if (namespace) {
      searchPayload.namespace = namespace;
    }

    const response = await fetch(`${PINECONE_CONFIG.baseUrl}/query`, {
      method: 'POST',
      headers: {
        'Api-Key': PINECONE_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pinecone search error:', response.status, errorText);
      throw new Error(`Pinecone search failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const matches = data.matches || [];
    console.log(`✅ Found ${matches.length} matches`);

    const transformedResults = matches.map(match => ({
      id: match.id,
      score: match.score,
      similarity: match.score,
      filename: match.metadata?.filename || 'Unknown',
      chunkIndex: match.metadata?.chunkIndex || 0,
      content: match.metadata?.content || '',
      metadata: match.metadata || {}
    }));

    res.json(transformedResults);

  } catch (error) {
    console.error('Error performing Pinecone search:', error);
    res.status(500).json({
      error: 'Error performing semantic search',
      details: error.message
    });
  }
});

app.post('/delete', async (req, res) => {
  const { ids, namespace = '' } = req.body;

  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'Invalid ids array' });
  }

  try {
    console.log(`🗑️ Deleting ${ids.length} vectors from Pinecone...`);

    const deletePayload = { ids };
    if (namespace) deletePayload.namespace = namespace;

    const response = await fetch(`${PINECONE_CONFIG.baseUrl}/vectors/delete`, {
      method: 'POST',
      headers: {
        'Api-Key': PINECONE_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(deletePayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pinecone delete error:', response.status, errorText);
      throw new Error(`Pinecone delete failed: ${response.status} - ${errorText}`);
    }

    console.log(`✅ Successfully deleted ${ids.length} vectors`);

    res.json({
      success: true,
      deletedCount: ids.length,
      message: 'Vectors successfully deleted from Pinecone'
    });

  } catch (error) {
    console.error('Error deleting from Pinecone:', error);
    res.status(500).json({
      error: 'Error deleting vectors from Pinecone',
      details: error.message
    });
  }
});

app.get('/stats', async (req, res) => {
  try {
    console.log('📊 Fetching Pinecone index statistics...');

    const response = await fetch(`${PINECONE_CONFIG.baseUrl}/describe_index_stats`, {
      method: 'POST',
      headers: {
        'Api-Key': PINECONE_CONFIG.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pinecone stats error:', response.status, errorText);
      throw new Error(`Pinecone stats failed: ${response.status} - ${errorText}`);
    }

    const stats = await response.json();
    console.log('✅ Retrieved index statistics');

    res.json({
      success: true,
      stats: stats,
      indexName: PINECONE_CONFIG.indexName
    });

  } catch (error) {
    console.error('Error getting Pinecone stats:', error);
    res.status(500).json({
      error: 'Error getting index statistics',
      details: error.message
    });
  }
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    availableRoutes: [
      'GET /health',
      'GET /stats',
      'POST /search',
      'POST /upsert',
      'POST /delete'
    ]
  });
});

app.listen(port, () => {
  console.log(`🚀 Semantic search server running at http://localhost:${port}`);
  console.log(`📊 Pinecone Index: ${PINECONE_CONFIG.indexName}`);
  console.log(`🌍 Environment: ${PINECONE_CONFIG.environment}`);
  console.log('\nAvailable endpoints:');
  console.log(`  GET  http://localhost:${port}/health`);
  console.log(`  GET  http://localhost:${port}/stats`);
  console.log(`  POST http://localhost:${port}/search`);
  console.log(`  POST http://localhost:${port}/upsert`);
  console.log(`  POST http://localhost:${port}/delete`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Gracefully shutting down server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Gracefully shutting down server...');
  process.exit(0);
});