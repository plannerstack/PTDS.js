/**
 * Class representing a line
 */
export default class Line {
  /**
   * Line constructor
   * @param  {string} code - Reference code
   * @param  {Array.<JourneyPattern>} journeyPatterns - List of journey patterns
   */
  constructor(code, journeyPatterns) {
    this.code = code;
    this.journeyPatterns = journeyPatterns;
  }
}
