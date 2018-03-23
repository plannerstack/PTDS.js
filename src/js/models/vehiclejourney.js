import VehicleStatus from '../vehiclestatus';

/**
 * Class representing the journey of a vehicle
 */
export default class VehicleJourney {
  /**
   * Vehicle journey constructor
   * @param  {string} code - Reference code
   * @param  {JourneyPattern} journeyPattern - Journey pattern which the journey belongs to
   * @param  {Array.<Date>} times - List of times of arrival at each stop
   * @param  {Object.<string, {
   *   distances: Array.<number>,
   *   times: Array.<Date>,
   *   vehicleNumber: number
   *  }>} realtime - Realtime data of the journey for each vehicle
   * @param  {boolean} cancelled - Whether the journey was cancelled
   */
  constructor(code, journeyPattern, times, realtime, cancelled) {
    this.code = code;
    this.journeyPattern = journeyPattern;
    this.times = times;
    this.realtime = realtime;
    this.cancelled = cancelled;

    // Compute static schedule as (time, distance) object pairs array
    this.staticSchedule = this.times
      .map((time, index) => ({
        time,
        // The times array is double the length of the distances array,
        // because we have for each stop the arrival and departure time.
        // Therefore we take the distance element with index corresponding
        // to half the index of the corresponding time element
        distance: this.journeyPattern.distances[Math.floor(index / 2)],
      }));
  }

  /**
   * Check if real time data is available
   * @return {boolean} - True if real time data is available, false otherwise
   */
  get isRealTime() {
    return typeof this.realtime !== 'undefined' && Object.keys(this.realtime).length !== 0;
  }

  /**
   * Compute the minimum and maximum time of the trip
   * @return {{first: Date, last: Date}} - First and last times of this journey

   */
  get firstAndLastTimes() {
    if (this.isRealTime) {
      // Extract first and last time for each vehicle
      const combinedFirstAndLast = Object.values(this.realtime)
        .filter(({ times }) => times.length > 0)
        .map(({ times }) => ({ first: times[0], last: times[times.length - 1] }));

      // Compute first and last time for all vehicles
      return {
        first: Math.min(...combinedFirstAndLast.map(vehicleCombinedFL => vehicleCombinedFL.first)),
        last: Math.max(...combinedFirstAndLast.map(vehicleCombinedFL => vehicleCombinedFL.last)),
      };
    }

    // If no realtime data is available, use static data
    return {
      first: this.times[0],
      last: this.times[this.times.length - 1],
    };
  }

  /**
   * Check if given a specific time, the journey is active
   * @param  {Date}  time - Time
   * @return {boolean} - True if the journey is active, false otherwise
   */
  isActive(time) {
    // If realtime data is available, the trip is considered active
    // if at least one of the vehicles is active
    if (this.isRealTime) {
      return Object.values(this.realtime).some(({ times }) =>
        times[0] <= time && time <= times[times.length - 1]);
    }

    return (this.times[0] <= time && time <= this.times[this.times.length - 1]);
  }

  /**
   * Given a distance and a time, decided the status of the vehicle compared to the static schedule
   * @param  {Date} time - Time
   * @param  {number} distance - Distance along route
   * @return {string} - Status of the vehicle
   */
  vehicleStatusComparedToSchedule(time, distance) {
    // Go over all the segments that make up the trip, looking for the segment in which
    // the vehicle is currently in in terms of distance traveled
    for (let i = 0; i < this.staticSchedule.length - 1; i += 1) {
      const { time: timeStop1, distance: distanceStop1 } = this.staticSchedule[i];
      const { time: timeStop2, distance: distanceStop2 } = this.staticSchedule[i + 1];

      const timeSeconds = time.getTime() / 1000;
      const timeStop1Seconds = timeStop1.getTime() / 1000;
      const timeStop2Seconds = timeStop2.getTime() / 1000;

      // If the distance traveled by the vehicle is between the start and end distances
      // of the current segment, we can decide its status
      if (distanceStop1 <= distance && distance <= distanceStop2) {
        // Compute the theoretical time that the vehicle should have to be on time
        // having traveled the current distance
        const theoreticalTime = (((timeStop2Seconds - timeStop1Seconds) /
                                  (distanceStop2 - distanceStop1)) * (distance - distanceStop1)) +
                                timeStop1Seconds;
        // Compare theoretical time with actual time and decide the status of the vehicle
        if (timeSeconds < theoreticalTime - 15) {
          return VehicleStatus.EARLY;
        } else if (theoreticalTime - 15 <= timeSeconds && timeSeconds <= theoreticalTime + 120) {
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
   *           positions: {time: Date, distance: number, status: string, prognosed: boolean}
   *          }>} - List of enriched realtime position info
   */
  getVehiclePositions() {
    if (!this.isRealTime) return [];

    return Object.values(this.realtime).map(({ vehicleNumber, times, distances }) => ({
      vehicleNumber,
      // For each vehicle, enrich its positions information by computing the "on time"
      // status at each position
      positions: times.map((time, index) => ({
        time,
        distance: distances[index],
        status: this.vehicleStatusComparedToSchedule(time, distances[index]),
        prognosed: time > new Date(),
      })),
    }));
  }

  /**
   * Get the position information of the vehicles of the trip at a given time
   * @param  {Date} time - Time
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
      // Special cases:
      // - if there is only one stop in the schedule, use the distance of that stop as approximation
      if (schedule.length === 1) {
        return schedule[0].distance;
      // - if the time asked for is smaller than the time of departure at the first stop of the
      //   trip, approximate the distance with the distance of the first stop
      } else if (time <= schedule[0].time) {
        return schedule[0].distance;
      // - if the time asked for is smaller than the time of arrival at the last stop of the trip,
      //   approximate  the distance with the distance of the last stop
      } else if (time >= schedule[schedule.length - 1].time) {
        return schedule[schedule.length - 1].distance;
      }

      // If we didn't fall in one of the previous cases, it means that the time asked is the
      // between the time of departure at the first stop and time of arrival at the last stop,
      // and there are at least 2 stops in the schedule
      let previousStopSchedule;
      let nextStopSchedule;

      for (let i = 0; i < schedule.length - 1; i += 1) {
        previousStopSchedule = schedule[i];
        nextStopSchedule = schedule[i + 1];
        if (previousStopSchedule.time <= time && time < nextStopSchedule.time) {
          // Compute percentage of time between previous and next stop by interpolation
          const percentage = (time - previousStopSchedule.time) /
                             (nextStopSchedule.time - previousStopSchedule.time);

          // Use the percentage to compute the actual distance of the vehicle by correspondence
          // to the distance list
          const distance = previousStopSchedule.distance +
            (percentage * (nextStopSchedule.distance - previousStopSchedule.distance));

          return distance;
        }
      }

      // We should never get here, it's just to make the linter happy
      return 0;
    };

    if (this.isRealTime) {
      return Object.values(this.realtime)
        .filter(({ times, distances }) => times.length > 0 && distances.length > 0)
        .map(({ vehicleNumber, times, distances }) => {
          const distance = getDistanceGivenSchedule(times.map((_time, index) =>
            ({ time: _time, distance: distances[index] })));

          return {
            vehicleNumber,
            position: this.getPositionFromDistance(distance, stopsLinks),
            distance,
            status: this.vehicleStatusComparedToSchedule(time, distance),
            prognosed: time > new Date(),
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
