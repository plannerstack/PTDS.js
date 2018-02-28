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
   * Computes the realtime positions information of a the vehicles belonging to this journey
   * @return {Array.<{
   *           vehichleNumber: number,
   *           positions: {time: number, distance: number, status: string}
   *          }>} - List of enriched realtime position info
   */
  getVehiclePositions() {
    if (!this.isRealTime) return [];

    /**
     * Considering an imaginary vehicle at time "time" located at distance "distance"
     * along the journey pattern of the trip, figure out if the vehicle would be
     * early, on time or late compared to the static schedule.
     * @param  {number} time - Time, see description
     * @param  {distance} distance - Distance, see description
     * @return {string} - Status of the vehicle as VehicleStatus enum property
     */
    const vehicleStatusComparedToSchedule = (time, distance) => {
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
          if (time < thTime) {
            return VehicleStatus.EARLY;
          } else if (time === thTime) {
            return VehicleStatus.ONTIME;
          }
          return VehicleStatus.LATE;
        }
      }

      // It could be that we don't find a segment that includes the position of the
      // vehicle in terms of distance. In that case signal it
      return VehicleStatus.UNDEFINED;
    };

    return this.realtimeData.map(({ vehicleNumber, times, distances }) => ({
      vehicleNumber,
      // For each vehicle, enrich its positions information by computing the "on time"
      // status at each position
      positions: times.map((time, index) => ({
        time: TimeUtils.secondsToHHMMSS(time),
        distance: distances[index],
        status: vehicleStatusComparedToSchedule(time, distances[index]),
      })),
    }));
  }

  /**
   * Get the distance traveled by each of the vehicles of the trip, given a specific time
   * @param  {number} time - Time in seconds since noon minus 12h
   * @return {Array.<{vehicleNumber: number, distance: number}>} - List of distances of each vehicle
   */
  getDistancesAtTime(time) {
    // Special case handling: when the time asked for is the time of the last stop of the trip.
    // In that case the distance traveled is the distance at which the last stop is located
    if (this.times[this.times.length - 1] === time) {
      return this.journeyPattern.distances[this.journeyPattern.distances.length - 1];
    }

    /**
     * Given a "schedule", computes the distance traveled at the given time
     * taken from the outer context.
     * The schedule can either be the static one or the real time one
     * @param  {Array.<{time: number, distance: number}>} schedule - Schedule, see description
     * @return {number} - Distance traveled along the journey pattern
     */
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
        (percentage * (previousStopSchedule.distance - previousStopSchedule.distance));

      return currentDistance;
    };

    // If the real time data is available, return the distance traveled of each
    // of the real time vehicles belonging to the trip
    if (this.isRealTime) {
      return this.realtimeData.map(({ vehicleNumber, times, distances }) => ({
        vehicleNumber,
        distance: getDistanceGivenSchedule(times.map((_time, index) =>
          ({ time: _time, distance: distances[index] }))),
      }));
    }

    return [{
      vehicleNumber: 0, // use fictitious vehicle number for static data
      distance: getDistanceGivenSchedule(this.staticSchedule),
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

    // Special case handling: when the distance asked for is the distance
    // at which the last stop is located
    if (distances[distances.length - 1] === distance) {
      const previousStop = stops[stops.length - 2];
      const nextStop = stops[stops.length - 1];
      const stopsLink = stopsLinks[`${previousStop.code}|${nextStop.code}`];

      return stopsLink.getPointAlongStopAreasSegmenyByPercentage(1.0);
    }

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
