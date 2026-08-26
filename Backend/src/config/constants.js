// Default network addresses — override via environment variables
export const DEFAULT_CAR_IP = process.env.CAR_IP || '192.168.0.50';
export const DEFAULT_CAR_PORT = parseInt(process.env.CAR_PORT, 10) || 80;

export const CAMERA_IP = process.env.CAMERA_IP || '192.168.0.51';
export const CAMERA_STREAM = `http://${CAMERA_IP}`;
