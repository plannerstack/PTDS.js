/**
 * Helper functions to deal with time
 */
export default class TimeUtils {
  /**
   * Convert the time in the proprietary format (seconds since noon minus 12h)
   * to a standardized time object
   * @param  {number} time - Time in seconds since noon minus 12h
   * @return {Date} - Date object representing the time
   */
  static secondsToDateObject(time) {
    // Compute days, hours, minutes and seconds from the proprietary format
    let days = 1;
    let hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = time % 60;

    if (hours >= 24) {
      days = Math.floor(hours / 24) + 1;
      hours %= 24;
    }

    // Use fictitious 1970/01/01 date to store the time
    const date = new Date('1/1/1970');
    date.setDate(days);
    date.setHours(hours);
    date.setMinutes(minutes);
    date.setSeconds(seconds);

    return date;
  }

  /**
   * Returns the current time in the fictitious day day
   * @return {Date} - Time in the fictitious day
   */
  static timeNow() {
    const dateNow = new Date();
    dateNow.setYear(1970);
    dateNow.setMonth(0);
    dateNow.setDate(1);
    return dateNow;
  }
}
