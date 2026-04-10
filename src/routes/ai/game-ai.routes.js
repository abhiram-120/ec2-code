const express = require('express');
const router = express.Router();
const gameAiController = require('../../controller/ai/game-ai.controller');
const AuthValidator = require('../../middleware/verify-token');

/**
 * API 1: Get Game Options
 * Returns available practice options for a game type
 */
// router.get('/options/:game_type', AuthValidator, gameAiController.getGameOptions);

/**
 * API 2: Get Option Items
 * Returns items for a specific option (topics, lessons, word lists)
 */
// router.get('/options/:game_type/:option_key/items', AuthValidator, gameAiController.getOptionItems);

/**
 * API 3: Start Game Session and Get Exercises
 * Creates session and returns 8 exercises
 */
// router.get('/:game_type/:option_key/:item_id?', AuthValidator, gameAiController.getGamesByOption);

//api 4 : start game by class
router.get('/start/by-class/:exercise_type/:class_id', AuthValidator, gameAiController.startGameByClass);

// api : get all games
router.get('/all-game', AuthValidator, gameAiController.getAllGames);

/**
 * API 5: Submit Game Session Results (update session on completion)
 * PUT — same resource as when started; updates progress and marks completed
 */
router.put('/session/submit', AuthValidator, gameAiController.submitGameSession);

module.exports = router;