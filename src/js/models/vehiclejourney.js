import VehicleStatus from '../vehiclestatus';
import TimeUtils from '../timeutils';

/**
 * Class representing the journey of a vehicle
 */
export default class VehicleJourney {
  /**
   * Vehicle journey constructor
   * @param  {string} code - Reference code
   * @param  {JourneyPattern} journeyPattern - Journey pattern which the journey belongs to
   * @param  {Array.<number>} times - List of times of arrival at each stop
   * @param  {Array.<{
   *           vehicleNumber: number,
   *           distances: Array<number>,
   *           times: Array<number>
   *          }>} realtimeData - Realtime data of the journey for each vehicle
   */
  constructor(code, journeyPattern, times, realtimeData) {
    this.code = code;
    this.journeyPattern = journeyPattern;
    this.times = times;
    this.realtimeData = realtimeData;

    // Compute static schedule as (time, distance) object pairs array
    this.staticSchedule = this.times
      .map((time, index) => ({ time, distance: this.journeyPattern.distances[index] }));
  }

  /**
   * Check if real time data is available
   * @return {boolean} - True if real time data is available, false otherwise
   */
  get isRealTime() {
    return typeof this.realtimeData !== 'undefined';
  }

  /**
   * Check if given a specific time in seconds, the journey is active
   * @param  {number}  time - Time in seconds since noon minus 12h
   * @return {boolean} - True if the journey is active, false otherwise
   */
  isActive(time) {
    // If realtime data is available, the trip is considered active
    // if at least one of the vehicles is active
    if (this.isRealTime) {
      return this.realtimeData.some(({ times }) =>
        times[0] <= time && time <= times[times.length - 1]);
    }

    return (this.times[0] <= time && time <= this.times[this.times.length - 1]);
  }

  /**
   * Given a distance and a time, decided the status of the vehicle compared to the static schedule
   * @param  {number} time - Time in seconds since noon minus 12h
   * @param  {number} distance - Distance along route
   * @return {string} - Status of the vehicle
   */
  vehicleStatusComparedToSchedule(time, distance) {
    // Go over all the segments that make up the trip, looking for the segment in which
    // the vehicle is currently in in terms of distance traveled
    for (let i = 0; i < this.staticSchedule.length - 1; i += 1) {
      const { time: timeStop1, distance: distanceStop1 } = this.staticSchedule[i];
      const { time: timeStop2, distance: distanceStop2 } = this.staticSchedule[i + 1];

      // If the distance traveled by the vehicle is between the start and end distances
      // of the current segment, we can decide its status
      if (distanceStop1 <= distance && distance <= distanceStop2) {
        // Compute the theoretical time that the vehicle should have to be on time
        // having traveled the current distance
        const thTime = (((timeStop2 - timeStop1) / (distanceStop2 - distanceStop1)) *
                        (distance - distanceStop1)) + timeStop1;
        // Compare theoretical time with actual time and decide the status of the vehicle
        if (time < (thTime - 15)) {
          return VehicleStatus.EARLY;
        } else if (thTime <= time && time <= (thTime + 120)) {
          return VehicleStatus.ONTIME;
        }
        return VehicleStatus.LATE;
      }
    }

    // It could be that we don't find a segment that includes the position of the
    // vehicle in terms of distance. In that case signal it
    return VehicleStatus.UNDEFINED;
  }

  /**
   * Computes the realtime positions information of a the vehicles belonging to this journey
   * @return {Array.<{
   *           vehichleNumber: number,
   *           positions: {time: number, distance: number, status: string, prognosed: boolean}
   *          }>} - List of enriched realtime position info
   */
  getVehiclePositions() {
    if (!this.isRealTime) return [];

    return this.realtimeData.map(({ vehicleNumber, times, distances }) => ({
      vehicleNumber,
      // For each vehicle, enrich its positions information by computing the "on time"
      // status at each position
      positions: times.map((time, index) => ({
        time: TimeUtils.secondsToHHMMSS(time),
        distance: distances[index],
        status: this.vehicleStatusComparedToSchedule(time, distances[index]),
        prognosed: TimeUtils.isInTheFuture(time),
      })),
    }));
  }

  /**
   * Get the position information of the vehicles of the trip at a given time
   * @param  {number} time - Time in seconds since noon minus 12h
   * @param  {Object.<string, StopsLink>} stopsLinks - Network project definition
   * @return {Array.<{
   *   vehicleNumber: number,
   *   position: Point,
   *   distance: number,
   *   status: string,
   *   prognosed: boolean,
   *  }>} - Position info for all the vehicles, see description
   */
  getPositionsAtTime(time, stopsLinks) {
    const getDistanceGivenSchedule = (schedule) => {
      let previousStopSchedule;
      let nextStopSchedule;

      for (let i = 0; i < schedule.length - 1; i += 1) {
        nextStopSchedule = schedule[i + 1];
        if (nextStopSchedule.time >= time) {
          previousStopSchedule = schedule[i];
          break;
        }
      }

      // Compute percentage of time between previous and next stop by interpolation
      const percentage = (time - previousStopSchedule.time) /
                         (nextStopSchedule.time - previousStopSchedule.time);

      // Use the percentage to compute the actual distance of the vehicle by correspondence
      // to the distance list
      const currentDistance = previousStopSchedule.distance +
        (percentage * (nextStopSchedule.distance - previousStopSchedule.distance));

      return currentDistance;
    };

    if (this.isRealTime) {
      return this.realtimeData.map(({ vehicleNumber, times, distances }) => {
        const distance = getDistanceGivenSchedule(times.map((_time, index) =>
          ({ time: _time, distance: distances[index] })));

        return {
          vehicleNumber,
          position: this.getPositionFromDistance(distance, stopsLinks),
          distance,
          status: this.vehicleStatusComparedToSchedule(time, distance),
          prognosed: TimeUtils.isInTheFuture(time),
        };
      });
    }

    const distance = getDistanceGivenSchedule(this.staticSchedule);

    return [{
      vehicleNumber: -1, // use fictitious vehicle number for static data
      distance,
      position: this.getPositionFromDistance(distance, stopsLinks),
      status: VehicleStatus.UNDEFINED,
      prognosed: false,
    }];
  }

  /**
   * Given a distance along the route and a network definition object,
   * compute the position of the vehicle
   * @param  {number} distance - Distance along the route
   * @param  {Object.<String, StopsLink>} stopsLinks - Network definition object
   * @return {Point} - Position of the vehicle
   */
  getPositionFromDistance(distance, stopsLinks) {
    const { stops, distances } = this.journeyPattern;

    let lastStopIndex = -1;
    for (let i = 0; i < distances.length - 1; i += 1) {
      if (distances[i] <= distance && distance <= distances[i + 1]) {
        lastStopIndex = i;
        break;
      }
    }

    // Get the codes of the previous and next stop of the tripData in the journey pattern
    const previousStop = stops[lastStopIndex];
    const nextStop = stops[lastStopIndex + 1];

    // Percentage of the distance between the previous and the next stop that is completed
    const percentage = (distance - distances[lastStopIndex]) /
                       (distances[lastStopIndex + 1] - distances[lastStopIndex]);

    // Get segment of the network on which the vehicle is now
    const stopsLink = stopsLinks[`${previousStop.code}|${nextStop.code}`];

    return stopsLink.getPointAlongStopAreasSegmenyByPercentage(percentage);
  }
}
