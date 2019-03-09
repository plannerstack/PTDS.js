import Point from './point';

/**
 * Class representing a stop area, that contains multiple stops
 */
export default class StopArea {
  /**
   * Stop area constructor.
   * It triggers the computation of the center of the area.
   * @param  {string} code - Reference code
   * @param  {Array.<Stop>} stops - Stops that belong to the area
   */
  constructor(code, stops) {
    this.code = code;
    this.stops = stops;
    this.center = this.computeCenter();
    this.name = stops[0].name; /* TODO: This might need to be improved */
  }

  /**
   * Computes the position of the center of the area, as average
   * of the positions of the stops (centroid).
   * @return {Point} - Position of the center of the area
   */
  computeCenter() {
    let [totalX, totalY] = [0, 0];

    for (const { position } of this.stops) {
      totalX += position.x;
      totalY += position.y;
    }

    const [averageX, averageY] = [totalX / this.stops.length, totalY / this.stops.length];

    return new Point(averageX, averageY);
  }
}
