import Point from './point.js';

/**
 * Class representing a segment, with start and end point
 */
export default class Segment {
  constructor(pointA, pointB) {
    this.pointA = pointA;
    this.pointB = pointB;
  }

  /**
   * Computes a point along the segment given a percentage
   *
   * @param  {Number} percentage - Given a percentage [0.0-1.0] computes the corresponding
   *                               point in the segment
   * @return {Point} Point corresponding to the percentage given
   */
  getPointByPercentage(percentage) {
    return new Point(
      this.pointA.x + ((this.pointB.x - this.pointA.x) * percentage),
      this.pointA.y + ((this.pointB.y - this.pointA.y) * percentage),
    );
  }
}
