/**
 * Class representing a generic point on the 2D plane
 */
export default class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Computes the centroid of a sequence of points
   *
   * @param  {Array} points - Array of Point objects
   * @return {Point} point corresponding to the centroid of the given points
   */
  static centroid(points) {
    let totalX = 0;
    let totalY = 0;

    for (const point of points) {
      totalX += point.x;
      totalY += point.y;
    }

    const averageX = totalX / points.length;
    const averageY = totalY / points.length;

    return new Point(averageX, averageY);
  }
}

