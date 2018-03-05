/**
 * Class representing a stop
 */
export default class Stop {
  /**
   * Stop constructor
   * @param  {string} code - Reference code
   * @param  {string} name - Name
   * @param  {Point} position - Position of the stop
   * @param  {(StopArea|string)} area - Stop area which the stop belongs to
   */
  constructor(code, name, position, area) {
    this.code = code;
    this.name = name;
    this.position = position;
    this.area = area;
  }
}
