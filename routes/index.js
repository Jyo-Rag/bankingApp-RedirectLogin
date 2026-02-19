import express from 'express';
const router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { authenticated: req.isAuthenticated(), user: req.user });
});

export default router;