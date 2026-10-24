const { Router } = require('express');

const createNotificationRouter = (controller) => {
  const router = Router();
  router.post('/', controller.create);
  router.get('/estado', controller.status);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.put('/:id/atender', controller.attend);
  return router;
};

module.exports = { createNotificationRouter };
