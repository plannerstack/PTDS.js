/**
 * Helper functions to deal with time
 */
export default class TimeUtils {
  /**
   * Convert the time in the proprietary format (seconds since noon minus 12h)
   * to a standardized time object
   * @param  {number} time - Time in seconds since noon minus 12h
   * @param  {string} referenceDate - Reference date contextualizing the time
   * @return {Date} - Date object representing the time
   */
  static secondsToDateObject(time, referenceDate) {
    // Compute days, hours, minutes and seconds from the proprietary format
    let hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = time % 60;

    const date = new Date(referenceDate);
    if (hours >= 24) {
      date.setDate(date.getDate() + 1);
      hours -= 24;
    }
    date.setHours(hours);
    date.setMinutes(minutes);
    date.setSeconds(seconds);
    return date;
  }
}
