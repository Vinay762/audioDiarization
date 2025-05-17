/* main.js - Deepgram Transcriber: use utterances
 * Usage: DEEPGRAM_API_KEY=your_key node main.js
 */
require('dotenv').config();
const { Deepgram } = require('@deepgram/sdk');

const DG_API_KEY = process.env.DEEPGRAM_API_KEY;
if (!DG_API_KEY) {
  console.error('Missing DEEPGRAM_API_KEY in environment.');
  process.exit(1);
}

const AUDIO_URL = process.env.AUDIO_URL;
const dg = new Deepgram(DG_API_KEY);

(async () => {
  try {
    // const options = {
    //   model: 'nova-2',
    //   smart_format: true,
    //   utt_split: 0.8,
    //   diarize: true,
    //   utterances : true,
    //   detect_language: true,
    // };

    const options = {
      model:  'general',       // generic “general” model
      tier:   'enhanced',      // enhanced tier (best accuracy)
      language:        'ta',   // force Tamil
      detect_language: false,  // disable auto-detect
      smart_format:    true,
      punctuate:       true,
      utterances:      true,
      utt_split:       0.8,
      diarize:         true,
    };
    

    const resp = await dg.transcription.preRecorded({ url: AUDIO_URL }, options);

    // Use Deepgram's utterances array directly
    const utterances = resp.results.utterances;

    // Format H:MM:SS
    const fmt = t => {
      const s = Math.round(t);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return `${h}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
    };

    // Build raw_transcript and transcript array
    const raw_transcript = utterances
      .map(u => `[${fmt(u.start)} -> ${fmt(u.end)}] SPEAKER${String(u.speaker).padStart(2,'0')}: ${u.transcript}`)
      .join('\n');

    const transcript = utterances.map(u => ({
      start: fmt(u.start),
      end: fmt(u.end),
      text: u.transcript,
      speaker: `SPEAKER${String(u.speaker).padStart(2,'0')}`
    }));

    const language = resp.metadata?.language?.code ?? 'hi';

    console.log(JSON.stringify({ raw_transcript, transcript, language }, null, 2));
  } catch (err) {
    console.error('Error during transcription:', err);
  }
})();
