/**
 * Class representing a journey pattern, i.e. a route.
 */
export default class JourneyPattern {
  /**
   * Journey pattern constructor
   * @param  {string} code - Reference code
   * @param  {Array.<Stop>} stops - List of stops
   * @param  {Array.<number>} distances - List of distances of each stop
   * @param  {(Line|string)} line - Line which the journey pattern belongs to
   * @param  {number} direction - Direction of the line
   */
  constructor(code, stops, distances, line, direction) {
    this.code = code;
    this.stops = stops;
    this.distances = distances;
    this.line = line;
    this.direction = direction;

    // Create Array with (stop, distance) pairs
    this.stopsDistances = this.stops.map((stop, index) => ({
      stop,
      distance: this.distances[index],
    }));
  }

  /**
   * Compute the minimum and maximum time of the trips in the vehicle journey
   */
  get firstAndLastTimes() {
    const combinedFirstAndLast = Object.values(this.vehicleJourneys)
      .map(trip => trip.firstAndLastTimes);

    return {
      first: Math.min(...combinedFirstAndLast.map(tripCombinedFL => tripCombinedFL.first)),
      last: Math.max(...combinedFirstAndLast.map(tripCombinedFL => tripCombinedFL.last)),
    };
  }
}
