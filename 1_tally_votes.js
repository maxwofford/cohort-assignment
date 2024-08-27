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

// get all cohorts & check if they are active
const cohorts = await loader("Loading unprocessed cohorts", () => cohortTable.select({
  filterByFormula: 'NOT({Processed})'
}).all())

const cohortsToUpdate = []
for (const cohort of cohorts) {
  // check if there are any votes for this cohort
  // download the vote data to check it
  const votes = await loader(`Loading votes for cohort ${cohort.id}`, () => voteTable.select({
    filterByFormula: `{Cohort Record ID} = '${cohort.id}'`
  }).all())
  // check every vote has a valid voter key

  let votesAreValid = true
  new Set(votes.map(v => v.fields['Voter Key'])).forEach(voterKeys => {
    const voterKey = voterKeys[0]
    if (!cohort.fields['Allowed Voter Keys'].includes(voterKey)) {
      console.log(`Invalid voter key ${voterKey} for cohort ${cohort.id}`)
      votesAreValid = false
    }
  })

  if (votesAreValid) {
    console.log("All votes are valid for cohort", cohort.id)
  } else {
    throw new Error(`Invalid votes for cohort ${cohort.id}`)
  }

  // check project scores
  const showcases = await loader(`Loading showcase for cohort ${cohort.id}`, () => showcaseTable.select({
    filterByFormula: `AND(
      {Active Cohort Record ID} = '${cohort.id}',
      {deleted} = FALSE()
    )`,
    sort: [{ field: 'Points (from Current Votes)', direction: 'desc' }]
  }).all())
  console.log("Found", showcases.length, "showcase(s) for cohort", cohort.id, "with scores", showcases.map(s => s.fields['Points (from Current Votes)']))
  const showcasesWithScores = showcases.filter(s => s.fields['Points (from Current Votes)'] > 0)
  const showcasesWithoutScores = showcases.filter(s => s.fields['Points (from Current Votes)'] == 0)
  if (showcasesWithScores.length == 0) {
    throw new Error(`No showcases have scores for cohort ${cohort.id}`)
  } else if (showcases.length != showcasesWithScores.length) {
    console.log("Some showcases have no scores")
  } else {
    console.log("All showcases have scores")
  }

  // top 5 showcases with scores win
  const winningShowcases = showcasesWithScores.slice(0, 5)
  // other showcases or showcases 0 scores lose
  const losingShowcases = showcasesWithScores.slice(5).concat(showcasesWithoutScores)

  cohortsToUpdate.push({
    id: cohort.id,
    fields: {
      'Processed': true,
      'Won Showcases': winningShowcases.map(s => s.id),
      'Lost Showcases': losingShowcases.map(s => s.id)
    }
  })
}

batchUpdate(cohortTable, cohortsToUpdate)

async function batchUpdate(table, records) {
  const chunks = []

  while (records.length > 0) {
    chunks.push(records.splice(0, 10))
  }

  for (const [index, chunk] of chunks.entries()) {
    await loader(`Updating ${table.name} ${index + 1} of ${chunks.length}`, () => table.update(chunk))
  }
}