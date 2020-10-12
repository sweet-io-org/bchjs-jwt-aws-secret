'use strict';

const AWS = require('aws-sdk')
const JwtLib = require('jwt-bch-lib')
const BCHJS = require('@psf/bch-js')

const AWSPENDING = 'AWSPENDING'
const AWSCURRENT = 'AWSCURRENT'

async function getBchJsCredentials(secretsManager) {
    // username and password are stored in a separate secret
    const secretData = await secretsManager.getSecretValue({ SecretId: process.env.BCH_JS_CREDENTIALS_ARN,
                                                             VersionStage: AWSCURRENT }).promise()
    const creds = JSON.parse(secretData.SecretString)
    console.log(`retrieved bch-js credentials, username is ${creds.username}`)
    return creds
}

async function getJwtAuthClient(secretsManager) {
    const creds = await getBchJsCredentials(secretsManager)
    // api is currently https://auth.fullstack.cash
    const fullstackApi = process.env.FULLSTACK_AUTH_URL 
    console.log(`calling fullstack api at ${fullstackApi} to create new token`)
    const jwtLib = new JwtLib({
        server: fullstackApi,
        login: creds.username,
        password: creds.password
    })
    return jwtLib
}

async function createJwtToken(jwtLib) {
    const isRegistered = await jwtLib.register()
    if (!isRegistered)
        throw new Error('username/password pair is not registered')
    const apiToken = await jwtLib.getApiToken(jwtLib.userData.apiLevel)
    console.log('created new JWT token')
    return apiToken    
}

async function createSecret(arn, token, secretsManager) {
    console.log('creating secret')
    // first make sure current secret exists, errors if not
    await secretsManager.getSecretValue({SecretId: arn, VersionStage: AWSCURRENT}).promise()
    // try and get the secret version, if it fails, put in a new secret
    try {
        await secretsManager.getSecretValue({SecretId: arn, VersionId: token, VersionStage: AWSPENDING}).promise()
        console.log(`successfully retrieved pending secret for ${arn}`)
    } catch (err) {
        const jwtLib = await getJwtAuthClient(secretsManager)
        const jwtToken = await createJwtToken(jwtLib)
        console.log(`setting new pending secret for ${arn}`)
        await secretsManager.putSecretValue( {SecretId: arn,
                                              ClientRequestToken: token,
                                              SecretString: jwtToken,
                                              VersionStages: [AWSPENDING]} ).promise()
    }
}



async function setSecret(arn, token, secretsManager) {
    // noting to do
    return
}

async function testSecret(arn, token, secretsManager) {
    const jwtLib = await getJwtAuthClient(secretsManager)
    await jwtLib.register()
    const result = jwtLib.validateApiToken()
    if (!result.isValid)
        throw new Error('Unable to validate JWT token')
    // also test against bch-js api directly, and get balance for our account
    const secretData = await secretsManager.getSecretValue({SecretId: arn, VersionStage: AWSPENDING, ClientRequestToken: token}).promise()
    const jwtToken = secretData.SecretString
    if (jwtToken !== jwtLib.userData.apiToken)
        throw new Error('jwt pending token does not match current token from auth server')
    const bchjs = new BCHJS({
        restURL: process.env.FULLSTACK_API_URL,
        apiToken: jwtToken})
    try {
        // use token to check balance of the account registered for user
        const bchAddr = jwtLib.userData.bchAddr
        const balance = await bchjs.Blockbook.balance(bchAddr)
        const realBalance = Number(balance.balance) + Number(balance.unconfirmedBalance)
        console.log(`Balance for bch-js account is ${realBalance} satoshis at address ${bchAddr}`)
    } catch (err) {
        throw new Error('unable to validate token')
    }
}

async function finishSecret(arn, token, secretsManager) {
    const metadata = await secretsManager.describeSecret({SecretId: arn}).promise()
    let currentVersion = null
    for (const [versionId, stages] of Object.entries(metadata.VersionIdsToStages)) {
        if (stages.includes(AWSCURRENT)) {
            if (versionId === token) {
                console.log(`secret ${arn} version ${token} already tagged as current`)
                return
            }
            currentVersion = versionId
            break
        }
    }
    await secretsManager.updateSecretVersionStage( {SecretId: arn,
                                                    VersionStage: AWSCURRENT,
                                                    MoveToVersionId: token,
                                                    RemoveFromVersionId: currentVersion}
                                                 ).promise()
    console.log(`secret rotation finished`)
}

// map state to a function
const STEP_FUNCS = { 'createSecret': createSecret,
                     'setSecret': setSecret,
                     'testSecret': testSecret,
                     'finishSecret': finishSecret }

async function lambda_handler(event) {
    const arn = event['SecretId']
    const token = event['ClientRequestToken']
    const step = event['Step']
    const secretsManager = new AWS.SecretsManager({endpoint: process.env.SECRETS_MANAGER_ENDPOINT})
    const metadata = await secretsManager.describeSecret({ SecretId: arn }).promise()
    if (!metadata.RotationEnabled)
        throw new Error(`secret version ${arn} rotation is disabled`)
    const versions = metadata.VersionIdsToStages
    if (!versions[token])
        throw new Error(`secret version ${token} has no stage for rotation of secret ${arn}`)
    if (versions[token].includes(AWSCURRENT)) {
        console.log(`secret ${arn} version ${token} is already set as ${AWSCURRENT}`)
        return
    }
    if (!versions[token].includes(AWSPENDING)) 
        throw new Error(`secret ${arn} version ${token} is not set as ${AWSPENDING}`)
        
    const stepFunc = STEP_FUNCS[step]
    if (!step)
        throw new Error(`unhandled state ${step}`)
    stepFunc(arn, token, secretsManager)
}
    
