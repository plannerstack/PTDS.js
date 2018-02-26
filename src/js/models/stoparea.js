import Point from '../point';

export default class StopArea {
  constructor(code, stops) {
    this.code = code;
    this.stops = stops;
    this._computeCenter();
  }

  _computeCenter() {
    let totalX = 0;
    let totalY = 0;

    for (const { position } of this.stops) {
      totalX += position.x;
      totalY += position.y;
    }

    const averageX = totalX / this.stops.length;
    const averageY = totalY / this.stops.length;

    this.center = new Point(averageX, averageY);
  }
}
