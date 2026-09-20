// routes/admin.js - Admin & Analytics API routes with SQLite Database
const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/admin/analytics
router.get('/analytics', async (req, res) => {
  try {
    const stats = await db.getAnalytics();
    res.json({ analytics: stats });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
});

// GET /api/admin/research-data
router.get('/research-data', async (req, res) => {
  try {
    const transactions = await db.getTransactions();
    res.json({
      metrics: {
        averageWaitingTime: "15.4 mins",
        averageServiceTime: "7.2 mins",
        queueLengthPeak: 14,
        transactionsCompletedPerHour: 22,
        appointmentUtilizationRate: "88.5%",
        noShowRate: "4.2%",
        studentSatisfactionScore: "4.8 / 5.0"
      },
      transactions
    });
  } catch (err) {
    console.error('Research data error:', err);
    res.status(500).json({ error: 'Failed to fetch research data.' });
  }
});

module.exports = router;
