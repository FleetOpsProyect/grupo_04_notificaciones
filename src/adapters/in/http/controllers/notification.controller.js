const {
  manualNotificationSchema,
  notificationIdSchema,
  listQuerySchema,
  parseBody,
  parseParameters,
} = require('../schemas/notification.schemas');

const createNotificationController = ({
  createManualNotification,
  getNotificationStatus,
  listNotifications,
  getNotification,
  markAlertAttended,
}) => ({
  async create(req, res, next) {
    try {
      const input = parseBody(manualNotificationSchema, req.body);
      const result = await createManualNotification({
        ...input,
        correlation_id: req.correlation_id,
      });
      res.status(201).location(`/api/v1/notificaciones/${result.notification_id}`).json(result);
    } catch (error) {
      next(error);
    }
  },

  async status(req, res, next) {
    try {
      res.status(200).json(await getNotificationStatus());
    } catch (error) {
      next(error);
    }
  },

  async list(req, res, next) {
    try {
      const query = parseParameters(listQuerySchema, req.query);
      res.status(200).json(await listNotifications(query));
    } catch (error) {
      next(error);
    }
  },

  async getById(req, res, next) {
    try {
      const { id } = parseParameters(notificationIdSchema, req.params);
      res.status(200).json(await getNotification(id));
    } catch (error) {
      next(error);
    }
  },

  async attend(req, res, next) {
    try {
      const { id } = parseParameters(notificationIdSchema, req.params);
      res.status(200).json(await markAlertAttended(id));
    } catch (error) {
      next(error);
    }
  },
});

module.exports = { createNotificationController };
