import express from 'express';
import { queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const result = await queryTenant(
      req.user.tenant_slug,
      'SELECT id, nome, cargo, foto_url, ativo FROM profissionais WHERE ativo = true ORDER BY nome ASC'
    );
    res.json({ profissionais: result.rows });
  } catch (error) {
    console.error('[GET PROFISSIONAIS ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch professionals.' });
  }
});

export default router;
