import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initPublicSchema } from './db/migrations.mjs';
import { initRedis } from './redis.mjs';

import authRoutes from './routes/auth.mjs';
import configRoutes from './routes/config.mjs';
import publicRoutes from './routes/public.mjs';
import agendamentosRoutes from './routes/agendamentos.mjs';
import servicosRoutes from './routes/servicos.mjs';
import clientesRoutes from './routes/clientes.mjs';
import caixaRoutes from './routes/caixa.mjs';
import estoqueRoutes from './routes/estoque.mjs';
import profissionaisRoutes from './routes/profissionais.mjs';
import notificationsRoutes from './routes/notifications.mjs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS and JSON parsing
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded logos statically
app.use('/uploads', express.static('uploads'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'Acionar v3 Monolith API',
    timestamp: new Date().toISOString()
  });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/config', configRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/agendamentos', agendamentosRoutes);
app.use('/api/servicos', servicosRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/caixa', caixaRoutes);
app.use('/api/estoque', estoqueRoutes);
app.use('/api/profissionais', profissionaisRoutes);
app.use('/api/notifications', notificationsRoutes);

// Global 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// Initialize database and start server
async function startServer() {
  try {
    await initPublicSchema();
    await initRedis().catch(err => console.warn('[REDIS WARNING] Could not connect to Redis, running without cache:', err.message));

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[ACIONAR V3 BACKEND] Running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[SERVER STARTUP ERROR]', err);
    process.exit(1);
  }
}

startServer();
