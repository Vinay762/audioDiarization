require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { Readable } = require('stream');

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
if (!SARVAM_API_KEY) {
  console.error('Missing SARVAM_API_KEY in environment variables');
  process.exit(1);
}

// Configuration
const AUDIO_SOURCE = 'https://oriserve-speech-analytics.s3.amazonaws.com/SIGMA/2024-08-21/7898345058_Pre_Team_Pre_Team_Sumit_K_1004_predictive__20240816081801-stereo.wav';
const DESTINATION_DIR = './output';
const BASE_URL = 'https://api.sarvam.ai/call-analytics/';

class SarvamBatchClient {
  constructor() {
    this.jobId = null;
    this.inputStoragePath = null;
    this.outputStoragePath = null;
  }

  async initializeJob() {
    console.log('\n🚀 Initializing job...');
    try {
      const response = await axios.post(
        BASE_URL + 'job/init',
        {},
        { headers: { 'API-Subscription-Key': SARVAM_API_KEY } }
      );
      
      console.log('Job initialized:', response.data);
      this.jobId = response.data.job_id;
      this.inputStoragePath = response.data.input_storage_path;
      this.outputStoragePath = response.data.output_storage_path;
      return response.data;
    } catch (error) {
      console.error('Error initializing job:', error.response?.data || error.message);
      throw error;
    }
  }

  async uploadFile(fileStream, fileName) {
    console.log('\n📤 Uploading file to input storage...');
    try {
      const formData = new FormData();
      formData.append('file', fileStream, { filename: fileName });

      const response = await axios.put(
        `${this.inputStoragePath}/${encodeURIComponent(fileName)}`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'API-Subscription-Key': SARVAM_API_KEY
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );

      console.log('File uploaded successfully');
      return response.data;
    } catch (error) {
      console.error('Error uploading file:', error.response?.data || error.message);
      throw error;
    }
  }

  async startJob() {
    console.log('\n▶️ Starting job...');
    try {
      const jobParameters = {
        job_id: this.jobId,
        job_parameters: {
          model: 'saaras:v2',
          with_diarization: true,
          num_speakers: 2,
          questions: [
            {
              id: '1',
              type: 'short answer',
              text: 'What is the main topic of the call?',
              description: 'Identify the primary subject discussed'
            },
            {
              id: '2',
              type: 'short answer',
              text: 'What is the sentiment of the customer?',
              description: 'Analyze the customer emotional tone'
            }
          ]
        }
      };

      const response = await axios.post(
        BASE_URL + 'job',
        jobParameters,
        {
          headers: {
            'API-Subscription-Key': SARVAM_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Job started successfully');
      return response.data;
    } catch (error) {
      console.error('Error starting job:', error.response?.data || error.message);
      throw error;
    }
  }

  async checkJobStatus() {
    console.log('\n🔍 Checking job status...');
    try {
      const response = await axios.get(
        BASE_URL + `job/${this.jobId}/status`,
        { headers: { 'API-Subscription-Key': SARVAM_API_KEY } }
      );

      console.log('Current job status:', response.data.job_state);
      return response.data;
    } catch (error) {
      console.error('Error checking job status:', error.response?.data || error.message);
      throw error;
    }
  }

  async downloadResults() {
    console.log('\n📥 Downloading results...');
    try {
      // Create output directory if it doesn't exist
      if (!fs.existsSync(DESTINATION_DIR)) {
        fs.mkdirSync(DESTINATION_DIR, { recursive: true });
      }

      // List files in output directory
      const listResponse = await axios.get(
        this.outputStoragePath,
        { headers: { 'API-Subscription-Key': SARVAM_API_KEY } }
      );

      // Download each file
      for (const file of listResponse.data) {
        const fileUrl = `${this.outputStoragePath}/${file.name}`;
        const downloadPath = `${DESTINATION_DIR}/${file.name}`;
        
        const fileResponse = await axios.get(fileUrl, { 
          headers: { 'API-Subscription-Key': SARVAM_API_KEY },
          responseType: 'stream'
        });

        const writer = fs.createWriteStream(downloadPath);
        fileResponse.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        console.log(`Downloaded: ${file.name}`);
      }

      console.log('All files downloaded successfully');
    } catch (error) {
      console.error('Error downloading results:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAudioStream() {
    if (AUDIO_SOURCE.startsWith('http')) {
      // Handle URL
      const response = await axios.get(AUDIO_SOURCE, { responseType: 'stream' });
      return {
        stream: response.data,
        name: AUDIO_SOURCE.split('/').pop() || 'audio.wav'
      };
    } else {
      // Handle local file
      if (!fs.existsSync(AUDIO_SOURCE)) {
        throw new Error(`File not found: ${AUDIO_SOURCE}`);
      }
      return {
        stream: fs.createReadStream(AUDIO_SOURCE),
        name: AUDIO_SOURCE.split('/').pop() || 'audio.wav'
      };
    }
  }
}

async function main() {
  try {
    const client = new SarvamBatchClient();

    // Step 1: Initialize job
    await client.initializeJob();

    // Step 2: Upload file
    const { stream, name } = await client.getAudioStream();
    await client.uploadFile(stream, name);

    // Step 3: Start job
    await client.startJob();

    // Step 4: Monitor job status
    let status = '';
    let attempts = 0;
    const maxAttempts = 60; // 10 minutes with 10 second intervals
    const interval = 10000; // 10 seconds

    while (attempts < maxAttempts) {
      attempts++;
      const statusResponse = await client.checkJobStatus();
      status = statusResponse.job_state;

      if (status === 'Completed') {
        console.log('✅ Job completed successfully!');
        break;
      } else if (status === 'Failed') {
        console.log('❌ Job failed!');
        console.log('Error:', statusResponse.error_message);
        return;
      }

      console.log(`⏳ Current status: ${status} (attempt ${attempts}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    if (status !== 'Completed') {
      console.log('❌ Job did not complete within expected time');
      return;
    }

    // Step 5: Download results
    await client.downloadResults();

    console.log('\n=== Processing Complete ===');
    console.log(`Results saved to: ${DESTINATION_DIR}`);

  } catch (error) {
    console.error('\n❌ Error during processing:', error.message);
    process.exit(1);
  }
}

main();