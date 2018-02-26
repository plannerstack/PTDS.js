import { zip } from 'lodash';

export default class JourneyPattern {
  constructor(code, stops, distances) {
    this.code = code;
    this.stops = stops;
    this.distances = distances;
  }

  get stopsDistances() {
    return zip(this.stops, this.distances)
      .map(([stop, distance]) => ({
        stop,
        distance,
      }));
  }
}
