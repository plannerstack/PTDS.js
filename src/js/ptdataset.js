import { keyBy } from 'lodash';

import Stop from './models/stop';
import StopsLink from './models/stopslink';
import StopArea from './models/stoparea';
import JourneyPattern from './models/journeypattern';
import Line from './models/line';
import VehicleJourney from './models/vehiclejourney';
import Point from './models/point';

import TimeUtils from './timeutils';

/**
 * Class representing a public transport dataset
 */
export default class PTDataset {
  constructor(inputData, referenceDate, markerData) {
    this.updateUrl = inputData.updateUrl;
    this.referenceDate = referenceDate;
    Object.assign(this, PTDataset.computeStopsAndStopAreas(inputData.scheduledStopPoints));
    Object.assign(this, this.computeLinesJourneyPatterns(inputData.journeyPatterns));
    this.vehicleJourneys = this.computeVehicleJourneys(inputData.vehicleJourneys);
    this.stopsLinks = this.computeLinks();
    this.markers = null;
    if (markerData != null && markerData.markers != null) {
      this.markers = this.computeMarkers(markerData.markers);
      this.addMarkersToDataset(this.markers);
    }

    // Compute times of the first and last stop of any journey in the dataset
    this.earliestTime = Math.min(...Object.values(this.journeyPatterns)
      .map(jp => jp.firstAndLastTimes.first));
    this.latestTime = Math.max(...Object.values(this.journeyPatterns)
      .map(jp => jp.firstAndLastTimes.last));
  }

  addMarkersToDataset(markers) {
    for (const marker of markers) {
      const { vehicleJourneyCode, vehicleNumber } = marker.reference;
      if (Object.prototype.hasOwnProperty.call(this.vehicleJourneys, vehicleJourneyCode)) {
        const vehicleJourneyData = this.vehicleJourneys[vehicleJourneyCode];
        const { rt } = vehicleJourneyData;
        if (rt != null && vehicleNumber != null
            && Object.prototype.hasOwnProperty.call(rt, vehicleNumber)) {
          const vehicleData = rt[vehicleNumber];
          if (Object.prototype.hasOwnProperty.call(vehicleData, 'markers')) {
            const markersData = vehicleData.markers;
            markersData.push(marker);
          } else {
            vehicleData.markers = [marker];
          }
        } else if (vehicleNumber == null) {
          if (Object.prototype.hasOwnProperty.call(vehicleJourneyData, 'markers')) {
            const markersData = vehicleJourneyData.markers;
            markersData.push(marker);
          } else {
            vehicleJourneyData.markers = [marker];
          }
        }
      }
    }
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
        .map(([code, { name, x, y, stopAreaRef: areaCode }]) => new Stop(code, name,
          new Point(x, y), areaCode)),
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
   * Converts raw journey pattern data to rich JourneyPattern and Line objects,
   * storing them in an object indexed by their code for fast lookup
   * @param  {Object} _journeyPatterns - Raw journey pattern data
   * @return {{journeyPatterns: Array.<JourneyPattern>, lines: Array.<Line>}} - Rich objects
   */
  computeLinesJourneyPatterns(_journeyPatterns) {
    // First, create the rich JourneyPattern objects and store them in an object by their
    // code for fast lookups by the journey pattern code.
    // The line property is initially a string with the code of the line,
    // later we turn it into a rich line object.
    const journeyPatterns = keyBy(
      Object.entries(_journeyPatterns).map(([code, {
        pointsInSequence: stops,
        distances,
        lineRef,
        direction,
      }]) => new JourneyPattern(
        code,
        stops.map(stopCode => this.stops[stopCode]),
        distances,
        lineRef,
        direction,
      )),
      journeyPattern => journeyPattern.code,
    );

    // Compute the aggregation of journey patterns into lines, to create
    // the rich Line objects.
    // To do this we create an object where the keys are the line codes
    // and the values are the list of JourneyPattern objects of the line
    const jpAggregation = {};
    for (const journeyPattern of Object.values(journeyPatterns)) {
      if (Object.prototype.hasOwnProperty.call(jpAggregation, journeyPattern.line)) {
        jpAggregation[journeyPattern.line].push(journeyPattern);
      } else {
        jpAggregation[journeyPattern.line] = [journeyPattern];
      }
    }

    // Create the object containing the rich Line objects, using as key the code of the line
    const lines = keyBy(
      Object.entries(jpAggregation)
        .map(([lineCode, lineJourneyPatterns]) => new Line(lineCode, lineJourneyPatterns)),
      line => line.code,
    );

    // Convert the line property of the journey patterns from simple string with code
    // to rich Line object
    for (const journeyPattern of Object.values(journeyPatterns)) {
      const line = lines[journeyPattern.line];
      journeyPattern.line = line;
    }

    return { journeyPatterns, lines };
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
        .map(([code, { times, journeyPatternRef, realtime, cancelled }]) => {
          // Convert time in seconds since noon minus 12h to Date object
          for (const rtVehicle of Object.values(realtime)) {
            rtVehicle.times = rtVehicle.times.map(time => TimeUtils
              .secondsToDateObject(time, this.referenceDate));
          }

          const vehicleJourney = new VehicleJourney(
            code,
            this.journeyPatterns[journeyPatternRef],
            times.map(time => TimeUtils.secondsToDateObject(time, this.referenceDate)),
            realtime,
            cancelled,
          );

          if (typeof this.journeyPatterns[journeyPatternRef].vehicleJourneys === 'undefined') {
            this.journeyPatterns[journeyPatternRef].vehicleJourneys = [vehicleJourney];
          } else {
            this.journeyPatterns[journeyPatternRef].vehicleJourneys.push(vehicleJourney);
          }

          return vehicleJourney;
        }),
      vehicleJourney => vehicleJourney.code,
    );
  }

  /**
   * Update raw vehicle journey realtime data into an existing VehicleJourney object,
   * fetch each object indexed by their code for fast lookup and update that object
   * @param  {Object} _vehicleJourneys Raw vehicle realtime data
   */
  updateVehicleJourneys(_vehicleJourneys) {
    for (const [code, { realtime, cancelled }] of Object.entries(_vehicleJourneys)) {
      // Convert time in seconds since noon minus 12h to Date object
      for (const rtVehicle of Object.values(realtime)) {
        rtVehicle.times = rtVehicle.times.map(time => TimeUtils
          .secondsToDateObject(time, this.referenceDate));
      }

      const vehicleJourney = this.vehicleJourneys[code];
      if (typeof vehicleJourney !== 'undefined') {
        vehicleJourney.rt = realtime;
        vehicleJourney.cancelled = cancelled;
      }
    }
  }

  /**
   * Transform the time used in the markers into Java Date.
   * @param  {Object} markers Raw marker data
   * @return {Object} - Enriched markers data
   */
  computeMarkers(markers) {
    return markers.map(({ id, reference, time, message, url }) => ({
      id,
      reference,
      time: TimeUtils.secondsToDateObject(time, this.referenceDate),
      message,
      url,
    }));
  }
}
