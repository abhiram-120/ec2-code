// app/controllers/middleware.js

const jwt = require('jsonwebtoken');
const config = require('../config/config');
const Users = require('../models/users');

const authMiddleware = (req, res, next) => {
  const secretKey = config.jwtSecret; // Use the same secret key as in the authController.js
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: Token missing' });
  }

  jwt.verify(token.split(' ')[1], secretKey, (err, decodedToken) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    req.userId = decodedToken.id;

    // Update last_active_at with throttling (default 15 minutes)
    const throttleSeconds = Number.parseInt(process.env.LAST_ACTIVE_THROTTLE_SECONDS || '900', 10) || 900;
    const now = Math.floor(Date.now() / 1000);
    Users.findByPk(decodedToken.id)
      .then((user) => {
        if (!user) return;
        const last = user.last_active_at ? Number(user.last_active_at) : 0;
        if (!last || now - last >= throttleSeconds) {
          return Users.update({ last_active_at: now }, { where: { id: decodedToken.id } });
        }
      })
      .catch(() => {});

    next();
  });
};

module.exports = authMiddleware;
