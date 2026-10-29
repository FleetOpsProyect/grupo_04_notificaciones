const { Router } = require('express');

const createNotificationRouter = (controller) => {
  const router = Router();
  router.post('/', controller.create);
  router.get('/status', controller.status);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.put('/:id/acknowledgement', controller.acknowledge);
  return router;
};

module.exports = { createNotificationRouter };
