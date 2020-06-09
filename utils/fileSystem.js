const fs = require('fs')
const path = require('path')
const filenamify = require('filenamify')
function _createWriteStream(path) {
    fs.createWriteStream(path)
}
function _createDir(path) {
    fs.mkdirSync(path, { recursive: true })
}

function _getDir(path) {
    return fs.readdirSync(path)
}

function _writeFile(path, data) {
    fs.writeFileSync(path, data, { flag: 'w+' })
}

function _readFile(path) {
    return fs.readFileSync(path)
}

function _checkIfExists(path) {
    return fs.existsSync(path)
}

function _getAppDocumentsPath(app) {
    return path.join(app.getPath('documents'), app.name)
}

function _filenamify(name) {
    return filenamify(name, { replacement: '' })
}

module.exports = {
    createDir: _createDir,
    createWriteStream: _createWriteStream,
    getDir: _getDir,
    writeFile: _writeFile,
    readFile: _readFile,
    checkIfExists: _checkIfExists,
    getAppDocumentsPath: _getAppDocumentsPath,
    filenamify: _filenamify,
}
