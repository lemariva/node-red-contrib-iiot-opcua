/*
 The BSD 3-Clause License

 Copyright 2016,2017,2018 - Klaus Landsdorf (http://bianco-royal.de/)
 Copyright 2015,2016 - Mika Karaila, Valmet Automation Inc. (node-red-contrib-opcua)
 All rights reserved.
 node-red-contrib-iiot-opcua
 */
'use strict'

/**
 * Read Node-RED node.
 *
 * @param RED
 */
module.exports = function (RED) {
  // SOURCE-MAP-REQUIRED
  let coreClient = require('./core/opcua-iiot-core-client')

  function OPCUAIIoTRead (config) {
    RED.nodes.createNode(this, config)
    this.attributeId = parseInt(config.attributeId) || 0
    this.maxAge = parseInt(config.maxAge) || 1
    this.depth = parseInt(config.depth) || 1
    this.name = config.name
    this.justValue = config.justValue
    this.showStatusActivities = config.showStatusActivities
    this.showErrors = config.showErrors
    this.parseStrings = config.parseStrings
    this.historyDays = parseInt(config.historyDays) || 1
    this.connector = RED.nodes.getNode(config.connector)

    let node = this
    node.reconnectTimeout = 1000
    node.sessionTimeout = null
    node.opcuaClient = null
    node.opcuaSession = null

    node.statusLog = function (logMessage) {
      if (RED.settings.verbose && node.showStatusActivities) {
        coreClient.readDebugLog('Status: ' + logMessage)
      }
    }

    node.setNodeStatusTo = function (statusValue) {
      node.statusLog(statusValue)
      let statusParameter = coreClient.core.getNodeStatus(statusValue, node.showStatusActivities)
      node.status({fill: statusParameter.fill, shape: statusParameter.shape, text: statusParameter.status})
    }

    node.handleReadError = function (err, msg) {
      coreClient.readDebugLog(err)
      if (node.showErrors) {
        node.error(err, msg)
      }

      if (node.connector && coreClient.core.isSessionBad(err)) {
        node.connector.resetBadSession()
      }
    }

    node.readFromSession = function (session, itemsToRead, originMsg) {
      let msg = Object.assign({}, originMsg)
      if (coreClient.core.checkSessionNotValid(session, 'Reader')) {
        return
      }

      coreClient.readDebugLog('Read With AttributeId ' + node.attributeId)

      switch (parseInt(node.attributeId)) {
        case coreClient.READ_TYPE.ALL:
          coreClient.readAllAttributes(session, itemsToRead, msg).then(function (readResult) {
            try {
              node.send(node.buildResultMessage('AllAttributes', readResult))
            } catch (err) {
              node.handleReadError(err, readResult.msg)
            }
          }).catch(function (err) {
            node.handleReadError(err, msg)
          })
          break
        case coreClient.READ_TYPE.VALUE:
          coreClient.readVariableValue(session, itemsToRead, msg).then(function (readResult) {
            try {
              let message = node.buildResultMessage('VariableValue', readResult)
              node.send(message)
            } catch (err) {
              node.handleReadError(err, readResult.msg)
            }
          }).catch(function (err) {
            node.handleReadError(err, msg)
          })
          break
        case coreClient.READ_TYPE.HISTORY:
          const startDate = new Date()
          node.historyStart = new Date()
          node.historyStart.setDate(startDate.getDate() - node.historyDays)
          node.historyEnd = new Date()

          coreClient.readHistoryValue(
            session,
            itemsToRead,
            msg.payload.historyStart || node.historyStart,
            msg.payload.historyEnd || node.historyEnd,
            msg)
            .then(function (readResult) {
              try {
                let message = node.buildResultMessage('HistoryValue', readResult)
                message.historyStart = readResult.startDate || node.historyStart
                message.historyEnd = readResult.endDate || node.historyEnd
                node.send(message)
              } catch (err) {
                node.handleReadError(err, readResult.msg)
              }
            }).catch(function (err) {
              node.handleReadError(err, msg)
            })
          break
        default:
          let item = null
          let transformedItem = null
          let transformedItemsToRead = []

          for (item of itemsToRead) {
            transformedItem = {
              nodeId: item,
              attributeId: Number(node.attributeId) || null
            }
            transformedItemsToRead.push(transformedItem)
          }

          coreClient.read(session, transformedItemsToRead, msg.payload.maxAge || node.maxAge, msg).then(function (readResult) {
            try {
              let message = node.buildResultMessage('Default', readResult)
              message.maxAge = node.maxAge
              node.send(message)
            } catch (err) {
              node.handleReadError(err, readResult.msg)
            }
          }).catch(function (err) {
            node.handleReadError(err, msg)
          })
      }
    }

    node.buildResultMessage = function (readType, readResult) {
      let message = readResult.msg
      message.payload = {}
      message.nodetype = 'read'
      message.readtype = readType
      message.attributeId = node.attributeId

      let dataValuesString = {}
      if (node.justValue) {
        dataValuesString = JSON.stringify(readResult.results, null, 2)
      } else {
        dataValuesString = JSON.stringify(readResult, null, 2)
      }

      try {
        RED.util.setMessageProperty(message, 'payload', JSON.parse(dataValuesString))
      } catch (err) {
        if (node.showErrors) {
          node.warn('JSON not to parse from string for dataValues type ' + JSON.stringify(readResult, null, 2))
          node.error(err, readResult.msg)
        }

        message.payload = dataValuesString
        message.error = err.message
      }

      message.justValue = node.justValue
      if (!node.justValue) {
        try {
          message.resultsConverted = {}
          let dataValuesString = JSON.stringify(readResult.results, null, 2)
          RED.util.setMessageProperty(message, 'resultsConverted', JSON.parse(dataValuesString))
        } catch (err) {
          if (node.showErrors) {
            node.warn('JSON not to parse from string for dataValues type ' + readResult.results)
            node.error(err, readResult.msg)
          }

          message.resultsConverted = null
          message.error = err.message
        }
      }

      return message
    }

    node.on('input', function (msg) {
      if (!coreClient.core.checkConnectorState(node, msg, 'Read')) {
        return
      }

      node.readFromSession(node.opcuaSession, coreClient.core.buildNodesToRead(msg), msg)
    })

    coreClient.core.registerToConnector(node)

    node.on('close', (done) => {
      coreClient.core.deregisterToConnector(node, done)
    })
  }

  RED.nodes.registerType('OPCUA-IIoT-Read', OPCUAIIoTRead)
}
