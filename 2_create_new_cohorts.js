#!/usr/bin/env bun

import ora from 'ora'

const loader = async (msg = 'loading', cb = () => {}) => {
  const spinner = ora(msg).start()
  try {
    const result = await cb()
    spinner.succeed()
    return result
  } catch (e) {
    spinner.fail(e.msg)
    throw e
  }
}

import Airtable from 'airtable'
Airtable.configure({
  apiKey: process.env.AIRTABLE_API_KEY
})
const base = Airtable.base('app4kCWulfB02bV8Q')
const showcaseTable = base('Showcase')
const cohortTable = base('Cohorts')
const voteTable = base('Vote')
const userTable = base('Users')

// get a list of all voters
const voters = await loader("Finding eligible voters", () => userTable.select({
  filterByFormula: 'NOT({Showcase} = BLANK())',
  fields: ['Slack ID'],
}).all())
console.log("Found", voters.length, "voter(s)")

// check all projects that haven't lost
const projectsThatNeedCohorts = await loader('Finding projects that need cohorts', () => showcaseTable.select({
  filterByFormula: 'AND({Lost Cohorts} = BLANK(), {Active Cohort Record ID} = BLANK())'
}).all())
console.log("Found", projectsThatNeedCohorts.length, "project(s) that need cohorts")

const hourToEndAt = 11
// get today's date
let startTime = new Date(new Date().setHours(hourToEndAt, 0, 0, 0))
if (startTime.getHours() >= hourToEndAt) {
  // if it's past 11am, start the cohort tomorrow
  startTime.setDate(startTime.getDate() + 1)
}
// almost 1 day after start time
let endTime = new Date(startTime)
endTime.setHours(endTime.getHours() + 23)

const newCohorts = []
const maxCohortSize = 18
const randomProjects = projectsThatNeedCohorts.sort(() => Math.random() > 0.5)
for (let i = 0; i < randomProjects.length; i+= maxCohortSize) {
  const projectChunk = randomProjects.slice(i, i + maxCohortSize)
  // create a list of voters who can't participate because their project is in the cohort
  const ineligibleVoterRecordIDs = projectChunk.map(p => p.fields['User Record ID'][0])
  // const eligibleVoters = randomVoters.filter(v => !ineligibleVoterRecordIDs.includes(v.id))
  newCohorts.push({
    records: {
      fields: {
        'start date': startTime.toISOString(),
        'end date': endTime.toISOString(),
        'Showcases': projectChunk.map(p => p.id),
        'Assigned Voters': [],
      },
    },
    ineligibleVoterRecordIDs,
  })
}

const randomVoters = voters.sort(() => Math.random() > 0.5)
// assign voters to cohorts, but make sure they don't get assigned to more than one cohort
// each cohort should have an equal number of voters
let unassignedVoters = 0
for (const voter of randomVoters) {
  // try to add voter to the cohort with the fewest voters
  const voterSortedCohorts = newCohorts.sort((a,b) => a.records.fields['Assigned Voters'].length > b.records.fields['Assigned Voters'].length)
  const cohort = voterSortedCohorts.find(c => !c.ineligibleVoterRecordIDs.includes(voter.id))
  if (cohort) {
    cohort.records.fields['Assigned Voters'].push(voter.id)
  } else {
    console.log("Can't assign voter to any cohort:", voter.id)
    unassignedVoters++
  }
}
const newCohortRecords = newCohorts.map(c => c.records)

const shouldContinue = confirm(`About to create ${newCohortRecords.length} cohort(s)
  with ${unassignedVoters} unassigned voter(s).
  The cohorts are active from ${startTime.toISOString()} to ${endTime.toISOString()}.
  Continue?`)
if (!shouldContinue) {
  console.log("Exiting")
  process.exit(0)
}

await batchCreate(cohortTable, newCohortRecords)

console.log("Created", newCohorts.length, "new cohort(s)! Now go out there and vote!")

async function batchCreate(table, records) {
  const chunks = []

  while (records.length > 0) {
    chunks.push(records.splice(0, 10))
  }

  for (const [index, chunk] of chunks.entries()) {
    await loader(`Creating chunk ${index + 1} of ${chunks.length}`, () => table.create(chunk))
  }
}
