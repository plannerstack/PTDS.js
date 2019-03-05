import Point from './point';

/**
 * Class to represent a link between two stops
 */
export default class StopsLink {
  /**
   * Stops link constructor.
   * Creates an "artificial" reference code concatenating the stop codes.
   * @param  {Stop} stop1 - First stop
   * @param  {Stop} stop2 - Second stop
   */
  constructor(stop1, stop2) {
    this.linkID = `${stop1.code}|${stop2.code}`;
    this.stop1 = stop1;
    this.stop2 = stop2;
  }

  /**
   * Get a point along the link given a certain percentage by interpolation
   * @param  {number} percentage - Percentage of "completion" of the link
   * @return {Point} - Point representing the requested position
   */
  getPointByPercentage(percentage) {
    return new Point(
      this.stop1.point.x + ((this.stop2.point.x - this.stop1.point.x) * percentage),
      this.stop1.point.y + ((this.stop2.point.y - this.stop1.point.y) * percentage),
    );
  }

  /**
   * Get a point along the link between the stop areas which each of the two stops belongs to,
   * using a percentage by interpolation
   * @param  {number} percentage - Percentage of "completion" of the link between stop areas
   * @return {Point} - Point representing the requested position
   */
  getPointAlongStopAreasSegmenyByPercentage(percentage) {
    return new Point(
      this.stop1.area.center.x
        + ((this.stop2.area.center.x - this.stop1.area.center.x) * percentage),
      this.stop1.area.center.y
        + ((this.stop2.area.center.y - this.stop1.area.center.y) * percentage),
    );
  }
}
