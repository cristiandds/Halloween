const { json, getBaseUrl } = require('./utils');

exports.handler = async (event) => {
  const baseUrl = getBaseUrl(event);
  const joinUrl = baseUrl ? `${baseUrl}/join` : '/join';
  const displaySeconds = parseInt(process.env.DISPLAY_SECONDS || '15', 10);
  const eventName = process.env.EVENT_NAME || 'Halloween Ritual';

  return json(200, {
    baseUrl,
    joinUrl,
    displaySeconds,
    eventName
  });
};
