const path = require('path');
const webpack = require('webpack');

const CleanWebpackPlugin = require('clean-webpack-plugin');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebPackPlugin = require('html-webpack-plugin');

const paths = {
  src: path.join(__dirname, 'src'),
  dist: path.join(__dirname, 'dist'),
  data: path.join(__dirname, 'data'),
};

module.exports = {
  context: paths.src,
  entry: ['./js/app.js', './scss/main.scss'],
  output: {
    filename: 'app.bundle.js',
    path: paths.dist,
  },
  module: {
    rules: [
      {
        test: /\.html$/,
        use: [{ loader: 'html-loader', options: { minimize: true } }],
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [{
          loader: 'babel-loader',
          options: { presets: ['env'] },
        }],
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'eslint-loader',
      },
      {
        test: /\.scss$/,
        use: ExtractTextPlugin.extract(['css-loader', 'sass-loader']),
      },
    ],
  },
  devtool: 'source-map',
  devServer: {
    contentBase: paths.dist,
    compress: true,
    port: '4800',
    stats: 'errors-only',
  },
  plugins: [
    new CleanWebpackPlugin([paths.dist]),
    new HtmlWebPackPlugin({
      template: './index.html',
      filename: './index.html',
    }),
    new ExtractTextPlugin({
      filename: 'main.bundle.css',
      allChunks: true,
    }),
    new CopyWebpackPlugin([
      {
        from: paths.data,
        to: `${paths.dist}/data`,
      },
    ]),
  ],
};
