import { zip } from 'lodash';

import VehicleStatus from '../vehiclestatus';
import TimeUtils from '../timeutils';

export default class VehicleJourney {
  constructor(code, journeyPattern, times, realtimeData) {
    this.code = code;
    this.journeyPattern = journeyPattern;
    this.times = times;
    if (typeof realtimeData !== 'undefined') this.realtimeData = realtimeData;
    this._computeStaticSchedule();
  }

  _computeStaticSchedule() {
    this.staticSchedule = this.times.map((time, index) => ({
      time,
      distance: this.journeyPattern.distances[index],
    }));
  }

  isRealTime() {
    return Object.prototype.hasOwnProperty.call(this, 'realtimeData');
  }

  isActive(time) {
    // If realtime data is available, the trip is considered active
    // if at least one of the vehicles is active
    if (this.isRealTime()) {
      return this.realtimeData.some(({ times }) =>
        times[0] <= time && time <= times[times.length - 1]);
    }

    return (this.times[0] <= time && time <= this.times[this.times.length - 1]);
  }

  getVehiclePositions() {
    if (!this.isRealTime()) return [];

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

    const tripPositions = [];
    for (const { vehicleNumber, times, distances } of this.realtimeData) {
      // Iterate over the (time, distance) pairs of the current vehicle
      // and determine the status of each position
      const positions = [];
      for (const [time, distance] of zip(times, distances)) {
        const vehicleStatus = vehicleStatusComparedToSchedule(time, distance);

        // Add the enriched position info to the list
        // of positions of the current vehicle
        positions.push({
          time: TimeUtils.secondsToHHMMSS(time),
          distance,
          vehicleStatus,
        });
      }

      // Add the enriched position info of the current vehicle
      // to the list of vehicle position info of the current trip
      tripPositions.push({
        vehicleNumber,
        positions,
      });
    }

    return tripPositions;
  }

  getDistanceAtTime(time) {
    // Special case handling: when the time asked for is the time of the last stop of the trip.
    // In that case the distance traveled is the distance at which the last stop is located
    if (this.times[this.times.length - 1] === time) {
      return this.journeyPattern.distances[this.journeyPattern.distances.length - 1];
    }

    // Given a list of times and distances, and the current time fromthe outer
    // context) computes the current distance of the vehicle.
    // The list of times and distances can be either the planned one or the realtime one of
    // a certain vehicle
    const coreGetDistance = (times, distances) => {
      let lastTimeIndex = 0;
      for (let i = 0; i < times.length - 1; i += 1) {
        if (times[i + 1] > time) {
          lastTimeIndex = i;
          break;
        }
      }

      // Compute percentage of time between previous and next stop by interpolation
      const percentage = (time - times[lastTimeIndex]) /
                         (times[lastTimeIndex + 1] - times[lastTimeIndex]);

      // Use the percentage to compute the actual distance of the vehicle by correspondence
      // to the distance list
      const currentDistance = distances[lastTimeIndex] +
        (percentage * (distances[lastTimeIndex + 1] - distances[lastTimeIndex]));

      return currentDistance;
    };

    // Check if real time data is available
    if (this.isRealTime()) {
      return this.realtime.map(({ vehicleNumber, times, distances }) => ({
        vehicleNumber,
        distance: coreGetDistance(times, distances),
      }));
    }

    return [{
      vehicleNumber: 0,
      distance: coreGetDistance(this.times, this.journeyPattern.distances),
    }];
  }

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
