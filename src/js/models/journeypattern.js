/**
 * Class representing a journey pattern, i.e. a route.
 */
export default class JourneyPattern {
  /**
   * Journey pattern constructor
   * @param  {string} code - Reference code
   * @param  {Array.<Stop>} stops - List of stops
   * @param  {Array.<number>} distances - List of distances of each stop
   * @param  {?(Line|string)} line - Line which the journey pattern belongs to
   * @param  {number} direction - Direction of the line
   */
  constructor(code, stops, distances, line, direction) {
    this.code = code;
    this.stops = stops;
    this.distances = distances;
    this.line = line;
    this.direction = direction;
  }

  /**
   * Getter for the combined list of stops and distances
   * @return {Array.<{stop: Stop, distance: number}>} Array of (stop, distance) pairs
   */
  get stopsDistances() {
    return this.stops.map((stop, index) => ({ stop, distance: this.distances[index] }));
  }
}
