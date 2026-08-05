import express from 'express';
import { queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/estoque/produtos
 */
router.get('/produtos', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const result = await queryTenant(tenant_slug, 'SELECT * FROM estoque_produtos ORDER BY nome ASC');
    res.json({ produtos: result.rows });
  } catch (err) {
    console.error('[GET ESTOQUE PRODUTOS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch inventory products.' });
  }
});

/**
 * POST /api/estoque/produtos
 */
router.post('/produtos', async (req, res) => {
  try {
    const { tenant_slug, profissional_id } = req.user;
    const { nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url, status_pagamento } = req.body;

    if (!nome) {
      return res.status(400).json({ error: 'Product name is required.' });
    }

    const qty = parseInt(quantidade || 0, 10);
    const custo = parseFloat(custo_unitario || 0);

    const result = await queryTenant(
      tenant_slug,
      `INSERT INTO estoque_produtos (
        profissional_id, nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        profissional_id,
        nome,
        tipo || 'consumo',
        qty,
        estoque_minimo || 1,
        custo,
        imagem_url || null
      ]
    );

    const produto = result.rows[0];

    // Log initial entrance movement if quantity > 0
    if (qty > 0) {
      await queryTenant(
        tenant_slug,
        `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
         VALUES ($1, $2, 'entrada', $3, 'Estoque inicial cadastrado')`,
        [produto.id, profissional_id, qty]
      );

      // Register exit/expense in caixa if cost > 0
      if (custo > 0) {
        const totalCusto = qty * custo;
        const statusPag = status_pagamento || 'pago';
        await queryTenant(
          tenant_slug,
          `INSERT INTO fluxo_caixa (
            profissional_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento
          ) VALUES ($1, 'saida', 'material', $2, $3, $4, 'dinheiro', CURRENT_DATE)`,
          [
            profissional_id,
            `Compra de Insumo: ${nome} (${qty} un × R$ ${custo.toFixed(2)})`,
            totalCusto,
            statusPag
          ]
        );
      }
    }

    res.status(201).json({ produto });
  } catch (err) {
    console.error('[POST ESTOQUE PRODUTO ERROR]', err);
    res.status(500).json({ error: 'Failed to create inventory product.' });
  }
});

/**
 * POST /api/estoque/movimentacoes
 */
router.post('/movimentacoes', async (req, res) => {
  try {
    const { tenant_slug, profissional_id } = req.user;
    const { produto_id, tipo, quantidade, motivo, status_pagamento } = req.body;

    if (!produto_id || !tipo || !quantidade) {
      return res.status(400).json({ error: 'Product ID, Movement Type, and Quantity are required.' });
    }

    const qtyNum = parseInt(quantidade, 10);

    // 1. Fetch current product
    const prodRes = await queryTenant(tenant_slug, 'SELECT nome, quantidade, custo_unitario FROM estoque_produtos WHERE id = $1', [produto_id]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const product = prodRes.rows[0];
    const currentQty = parseInt(product.quantidade || 0, 10);
    const custo = parseFloat(product.custo_unitario || 0);
    let newQty = currentQty;

    if (tipo === 'entrada') newQty += qtyNum;
    else if (tipo === 'saida') newQty = Math.max(0, currentQty - qtyNum);
    else if (tipo === 'ajuste') newQty = qtyNum;

    // 2. Update product quantity
    await queryTenant(tenant_slug, 'UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2', [newQty, produto_id]);

    // 3. Insert movement log
    const movRes = await queryTenant(
      tenant_slug,
      `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [produto_id, profissional_id, tipo, qtyNum, motivo || null]
    );

    // 4. Register expense in caixa if entrada and cost > 0
    if (tipo === 'entrada' && custo > 0) {
      const total = qtyNum * custo;
      const desc = `Reposição de Estoque: ${product.nome} (${qtyNum} un × R$ ${custo.toFixed(2)})`;
      const statusPag = status_pagamento || 'pago';

      await queryTenant(
        tenant_slug,
        `INSERT INTO fluxo_caixa (
          profissional_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento
        ) VALUES ($1, 'saida', 'material', $2, $3, $4, 'dinheiro', CURRENT_DATE)`,
        [profissional_id, desc, total, statusPag]
      );
    }

    res.status(201).json({
      message: 'Inventory movement recorded.',
      movimentacao: movRes.rows[0],
      nova_quantidade: newQty
    });
  } catch (err) {
    console.error('[POST ESTOQUE MOVIMENTACAO ERROR]', err);
    res.status(500).json({ error: 'Failed to record inventory movement.' });
  }
});

export default router;
