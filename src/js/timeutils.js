/**
 * Helper functions to deal with time
 */
export default class TimeUtils {
  static secondsToDateObject(time) {
    let days = 1;
    let hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = time % 60;

    if (hours >= 24) {
      days = Math.floor(hours / 24) + 1;
      hours %= 24;
    }

    const date = new Date('1/1/1970');
    date.setDate(days);
    date.setHours(hours);
    date.setMinutes(minutes);
    date.setSeconds(seconds);

    return date;
  }

  static timeNow() {
    const dateNow = new Date();
    dateNow.setYear(1970);
    dateNow.setMonth(0);
    dateNow.setDate(1);
    return dateNow;
  }
}
