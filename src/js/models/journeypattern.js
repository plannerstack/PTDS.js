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
   * @return {{first: Date, last: Date}} - First and last times of the journeys in this pattern
   */
  get firstAndLastTimes() {
    const combinedFirstAndLast = Object.values(this.vehicleJourneys)
      .map(trip => trip.firstAndLastTimes);

    return {
      first: Math.min(...combinedFirstAndLast.map(tripCombinedFL => tripCombinedFL.first)),
      last: Math.max(...combinedFirstAndLast.map(tripCombinedFL => tripCombinedFL.last)),
    };
  }

  /**
   * Finds shared links between the journey pattern and another one.
   * A link is shared if it's between the same two stop areas.
   * @param  {JourneyPattern} otherJP - The other journey pattern
   * @return {Array.<{
     *         withinItself: [number, number],
     *         withinOther: [number, number]
   *         }>} - Array describing the correspondance between the links
   *               in the two journey patterns
   */
  sharedLinks(otherJP) {
    const result = [];

    for (let index = 0; index < this.stops.length - 1; index += 1) {
      const jpStopA = this.stops[index];
      const jpStopB = this.stops[index + 1];

      for (let index2 = 0; index2 < otherJP.stops.length - 1; index2 += 1) {
        const otherJPStopA = otherJP.stops[index2];
        const otherJPStopB = otherJP.stops[index2 + 1];

        if (jpStopA.area === otherJPStopA.area && jpStopB.area === otherJPStopB.area) {
          result.push({
            withinItself: [index, index + 1],
            withinOther: [index2, index2 + 1],
          });
        }
      }
    }

    return result;
  }
}
