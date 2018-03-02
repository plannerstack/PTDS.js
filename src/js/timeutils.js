/**
 * Helper functions to deal with time
 */
export default class TimeUtils {
  /**
   * Converts a time in HH:MM:SS format to the time in seconds since noon minus 12h
   * TODO: Does it work correctly with daylight savings time? Does it make sense to consider this?
   * @param  {String} timeInHHMMSS - Time in HH:SS:MM format
   * @return {Number} - Time in seconds since midnight
   */
  static HHMMSStoSeconds(timeInHHMMSS) {
    const [hours, minutes, seconds] = timeInHHMMSS.split(':');

    return (parseInt(hours, 10) * 3600) + (parseInt(minutes, 10) * 60) + parseInt(seconds, 10);
  }

  /**
   * Converts a time in seconds since noon minus 12h to the HH:MM:SS format
   * TODO: Does it work correctly with daylight savings time? Does it make sense to consider this?
   * @param  {Number} timeInSecondsSinceNoonMinus12h - Time in seconds since noon minus 12h
   * @return {String} - Time in HH:MM:SS format
   */
  static secondsToHHMMSS(timeInSecondsSinceNoonMinus12h) {
    const hours = Math.floor(timeInSecondsSinceNoonMinus12h / 3600);
    const minutes = Math.floor((timeInSecondsSinceNoonMinus12h % 3600) / 60);
    const seconds = Math.floor((timeInSecondsSinceNoonMinus12h % 3600) % 60);

    // Helper function to get a positive integer < 100 padded with a zero in front if < 10
    const twoDigits = number => `0${number}`.slice(-2);

    return `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
  }

  /**
   * Checks if a given time in seconds since noon minus 12h is in the future
   * @param  {time}  time - Time in seconds since noon minus 12h
   * @return {boolean} - Whether the time is in the future
   */
  static isInTheFuture(time) {
    const currentTimestamp = Date.now();
    const timestampAt12 = (new Date()).setHours(12, 0, 0, 0);
    return currentTimestamp - (timestampAt12 - (60 * 60 * 12 * 1000)) < time * 1000;
  }
}
