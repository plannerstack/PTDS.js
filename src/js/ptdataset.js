import { keyBy } from 'lodash';

import Stop from './models/stop';
import StopsLink from './models/stopslink';
import StopArea from './models/stoparea';
import JourneyPattern from './models/journeypattern';
import VehicleJourney from './models/vehiclejourney';
import Point from './models/point';

/**
 * Class representing a public transport dataset
 */
export default class PTDataset {
  constructor(inputData) {
    Object.assign(this, PTDataset.computeStopsAndStopAreas(inputData.scheduledStopPoints));
    this.journeyPatterns = this.computeJourneyPatterns(inputData.journeyPatterns);
    this.vehicleJourneys = this.computeVehicleJourneys(inputData.vehicleJourneys);
    this.stopsLinks = this.computeLinks();
  }

  /**
   * Convert raw stops data into rich Stop and StopArea objects,
   * storing them in an object indexed by their code for fast lookup
   * and return that object
   * @param  {Object} scheduledStopPoints Raw stops data
   * @return {{stops: Array.<Stop>, stopAreas: Array.<StopArea>}} - Stop and stop area data
   */
  static computeStopsAndStopAreas(scheduledStopPoints) {
    // First, create the rich Stop objects and store them in an object by their
    // code for fast lookups by the stop code.
    // The stopArea property is initially a string with the code of the area,
    // later we turn it into a rich StopArea object.
    const stops = keyBy(
      Object.entries(scheduledStopPoints)
        .map(([code, { name, x, y, area: areaCode }]) =>
          new Stop(code, name, new Point(x, y), areaCode)),
      stop => stop.code,
    );

    // Compute the aggregation of stops into stop areas, to create
    // the rich StopArea objects.
    // To do this we create an object where the keys are the stop area codes
    // and the values are the list of Stop objects of the stop area
    const stopAreasAggregation = {};
    for (const stop of Object.values(stops)) {
      if (Object.prototype.hasOwnProperty.call(stopAreasAggregation, stop.area)) {
        stopAreasAggregation[stop.area].push(stop);
      } else {
        stopAreasAggregation[stop.area] = [stop];
      }
    }

    // Create the object containing the rich StopArea objects, using as key the code of the area
    const stopAreas = keyBy(
      Object.entries(stopAreasAggregation)
        .map(([stopAreaCode, stopAreaStops]) => new StopArea(stopAreaCode, stopAreaStops)),
      stopArea => stopArea.code,
    );

    // Convert the stopArea property of the stops from simple string with code
    // to rich StopArea object
    for (const stop of Object.values(stops)) {
      const stopArea = stopAreas[stop.area];
      stop.area = stopArea;
    }

    return { stops, stopAreas };
  }

  /**
   * Convert raw journey pattern data into rich JourneyPattern objects,
   * storing them in an object indexed by their code for fast lookup
   * and return that object
   * @param  {Object} _journeyPatterns Raw journey pattern data
   * @return {Object.<string, JourneyPattern>} - Enriched journey pattern list
   */
  computeJourneyPatterns(_journeyPatterns) {
    // Create the list of rich JourneyPattern objects, stored in an object
    // with the journey pattern code as key for fast lookup
    return keyBy(
      Object.entries(_journeyPatterns).map(([code, { pointsInSequence: stops, distances }]) =>
        new JourneyPattern(
          code,
          stops.map(stopCode => this.stops[stopCode]),
          distances,
        )),
      journeyPattern => journeyPattern.code,
    );
  }

  /**
   * Create rich StopsLink objects representing the existing links between
   * the stops, basing on the journeypatterns. The links are stored in an object
   * indexed by their ID ("stop1code|stop2code") for fast lookup and return that object
   * @return {Object.<string, StopsLink>} - Network definition object
   */
  computeLinks() {
    // Create the list of rich StopsLink objects, stored in an object
    // with the linkID ("stop1code|stop2code") key for fast lookup
    const stopsLinks = {};
    for (const { stops } of Object.values(this.journeyPatterns)) {
      for (let i = 0; i < stops.length - 1; i += 1) {
        const [stop1, stop2] = [stops[i], stops[i + 1]];
        stopsLinks[`${stop1.code}|${stop2.code}`] = new StopsLink(stop1, stop2);
      }
    }

    return stopsLinks;
  }

  /**
   * Convert raw vehicle journey data into rich VehicleJourney objects,
   * storing them in an object indexed by their code for fast lookup
   * and return that object
   * @param  {Object} _vehicleJourneys Raw vehicle data
   * @return {Object.<string, VehicleJourney>} - Enriched vehicle journey data
   */
  computeVehicleJourneys(_vehicleJourneys) {
    return keyBy(
      Object.entries(_vehicleJourneys)
        .map(([code, { times, journeyPatternRef, realtime: realtimeData }]) =>
          new VehicleJourney(
            code,
            this.journeyPatterns[journeyPatternRef],
            times,
            realtimeData,
          )),
      vehicleJourney => vehicleJourney.code,
    );
  }
}
