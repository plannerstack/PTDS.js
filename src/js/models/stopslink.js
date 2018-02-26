import Point from '../point';

export default class StopsLink {
  constructor(stop1, stop2) {
    this.linkID = `${stop1.code}|${stop2.code}`;
    this.stop1 = stop1;
    this.stop2 = stop2;
  }

  getPointByPercentage(percentage) {
    return new Point(
      this.stop1.point.x + ((this.stop2.point.x - this.stop1.point.x) * percentage),
      this.stop1.point.y + ((this.stop2.point.y - this.stop1.point.y) * percentage),
    );
  }

  getPointAlongStopAreasSegmenyByPercentage(percentage) {
    return new Point(
      this.stop1.area.center.x +
        ((this.stop2.area.center.x - this.stop1.area.center.x) * percentage),
      this.stop1.area.center.y +
        ((this.stop2.area.center.y - this.stop1.area.center.y) * percentage),
    );
  }
}
