const express = require('express');
const bodyParser = require('body-parser');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Google Generative AI Library

const app = express();
const port = 5000;

app.use(bodyParser.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Function to check directory permissions
const checkPermissions = (dir) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (err) {
    console.error(`No write permission for directory: ${dir}`);
    return false;
  }
  return true;
};

// Code Compilation Endpoint
app.post('/compile', async (req, res) => {
  const { code, language, input, libraries } = req.body;

  // Ensure temp directory exists
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    try {
      fs.mkdirSync(tempDir);
    } catch (err) {
      console.error(`Error creating temp directory: ${err}`);
      return res.status(500).json({ output: `Error creating temp directory: ${err.message}` });
    }
  }

  // Check if the temp directory is writable
  if (!checkPermissions(tempDir)) {
    return res.status(500).json({ output: 'No write permission for temp directory' });
  }

  // Generate a unique filename for each request
  const tempFile = path.join(tempDir, uuidv4() + (language === 'javascript' ? '.js' : language === 'python' ? '.py' : '.c'));
  fs.writeFileSync(tempFile, code);

  // Install libraries if provided
  if (libraries && libraries.length > 0) {
    let packageInstallCommand;
    if (language === 'python') {
      packageInstallCommand = `pip install ${libraries.join(' ')}`;
    } else if (language === 'javascript') {
      packageInstallCommand = `npm install ${libraries.join(' ')}`;
    }

    if (packageInstallCommand) {
      try {
        execSync(packageInstallCommand, { stdio: 'inherit' });
      } catch (error) {
        console.error(`Error installing packages: ${error}`);
        return res.status(500).json({ output: `Error installing packages: ${error.message}` });
      }
    }
  }

  let command;
  let outputBinary;
  if (language === 'javascript') {
    command = `node ${tempFile}`;
  } else if (language === 'python') {
    command = `python ${tempFile}`;
  } else if (language === 'c') {
    outputBinary = path.join(tempDir, uuidv4());
    command = `gcc ${tempFile} -o ${outputBinary} && ${outputBinary}`;
  } else {
    fs.unlinkSync(tempFile);
    return res.status(400).json({ output: 'Unsupported language' });
  }

  const process = exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${stderr}`);
      return res.status(500).json({ output: stderr });
    }
    
    // Cleanup temp files
    try {
      fs.unlinkSync(tempFile);
      if (language === 'c' && outputBinary && fs.existsSync(outputBinary)) {
        fs.unlinkSync(outputBinary);
      }
    } catch (cleanupError) {
      console.error(`Error during cleanup: ${cleanupError}`);
    }

    const plotPath = path.join(tempDir, 'plot.png');
    if (fs.existsSync(plotPath)) {
      try {
        const plotBase64 = fs.readFileSync(plotPath, { encoding: 'base64' });
        fs.unlinkSync(plotPath);  // Remove the plot file after sending
        res.json({ output: stdout, plot: plotBase64 });
      } catch (plotError) {
        console.error(`Error reading plot file: ${plotError}`);
        res.json({ output: stdout, plot: '' });
      }
    } else {
      res.json({ output: stdout });
    }
  });

  if (input) {
    process.stdin.write(input);
    process.stdin.end();
  }
});

// Code Generation Endpoint
app.post('/generate-code', async (req, res) => {
  const { query, language } = req.body;

  try {
    const apiKey = ""; // Replace with your API key
    const genAI = new GoogleGenerativeAI(apiKey); 
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `Generate ${language} code for the following task: ${query}`;
    const result = await model.generateContent(prompt);

    const response = await result.response;
    let generatedCode = await response.text();
    
    // Extract the code block from the generated response
    const codeBlockRegex = /```(?:[\w\W]*?)```/g;
    const codeMatches = generatedCode.match(codeBlockRegex);
    let codeOnly = codeMatches ? codeMatches[0].replace(/```/g, '').trim() : generatedCode.trim();

    res.json({ code: codeOnly });
  } catch (error) {
    console.error(`Error generating code: ${error}`);
    res.status(500).json({ output: `Error generating code: ${error.message}` });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
