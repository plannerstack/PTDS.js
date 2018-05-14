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
   * Finds shared sequences of links between the journey pattern and another one.
   * A link is shared if it's between the same two stop areas.
   * @param  {JourneyPattern} otherJP - The other journey pattern
   * @return {boolean|{referenceSequences: Array.<Array.<number>>,
   *                   otherSequences: Array.<Array.<number>>}} - Array describing the
   *  correspondance between the reference and the other journey pattern
   */
  sharedSequences(otherJP) {
    // The idea is that in a "reference sequence" we store the index of the matching stops within
    // the reference journey pattern while in the "other sequence" we store the index of the
    // matching stops in the other journey pattern
    const referenceSequences = [];
    const otherSequences = [];
    let foundSharedLink = false;

    // Iterate over the links of the JP
    for (let refIndex = 0; refIndex < this.stops.length - 1; refIndex += 1) {
      // Extract (stopA, stopB) pairs
      const jpStopA = this.stops[refIndex];
      const jpStopB = this.stops[refIndex + 1];

      // Iterate over the links of the other JP
      for (let otherIndex = 0; otherIndex < otherJP.stops.length - 1; otherIndex += 1) {
        // Extract (oStopA, oStopB) pairs
        const otherJPStopA = otherJP.stops[otherIndex];
        const otherJPStopB = otherJP.stops[otherIndex + 1];

        // If we find a shared link between the journey patterns (same stop areas)
        if (jpStopA.area === otherJPStopA.area && jpStopB.area === otherJPStopB.area) {
          foundSharedLink = true;
          if (!referenceSequences.length) {
            // If the reference sequences is list, add the first sequence with the found link
            referenceSequences.push([refIndex, refIndex + 1]);
            otherSequences.push([otherIndex, otherIndex + 1]);
          } else {
            // Get the last added reference sequence and index
            const lastAddedRefSequence = referenceSequences[referenceSequences.length - 1];
            const lastAddedRefIndex = lastAddedRefSequence[lastAddedRefSequence.length - 1];

            // If the last added reference index is different than the current index, it means the
            // link is non contiguous and therefore we start a new sequence
            if (lastAddedRefIndex !== refIndex) {
              referenceSequences.push([refIndex, refIndex + 1]);
              otherSequences.push([otherIndex, otherIndex + 1]);
            } else {
              // Otherwise we are continuing a contiguous sequence
              const lastAddedOtherSequence = otherSequences[otherSequences.length - 1];
              lastAddedRefSequence.push(refIndex + 1);
              lastAddedOtherSequence.push(otherIndex + 1);
            }
          }
        }
      }
    }

    // If no shared link was found, return false
    return foundSharedLink ? { referenceSequences, otherSequences } : false;
  }
}
