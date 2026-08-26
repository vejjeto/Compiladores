// Default network addresses — override via localStorage
const NetworkConfig = {
  get CAR_IP() { return localStorage.getItem('carIp') || '192.168.0.50'; },
  get CAR_PORT() { return parseInt(localStorage.getItem('carPort'), 10) || 80; },
  get CAMERA_IP() { return localStorage.getItem('cameraIp') || '192.168.0.51'; }
};
