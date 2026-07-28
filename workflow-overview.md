AI Sales Coach Agent - Installation & Setup Guide

Overview

This workflow automatically analyzes sales calls from Fathom, generates insights using Claude AI, and posts summaries to Slack while logging data to Google Sheets.



Prerequisites

Before you begin, ensure you have:





n8n installed (self-hosted or n8n Cloud account)



Active accounts for:





Fathom (for call recordings)



OpenRouter (for AI access)



Slack (for notifications)



Google Sheets (for data storage)



Part 1: Platform Setup

Step 1: Set Up OpenRouter Account





Go to https://openrouter.ai/



Sign up for an account or log in



Navigate to Settings > API Keys



Click Create New Key



Copy and save your API key securely (you'll need this later)



Add credits to your account (minimum $5 recommended)



Note: This workflow uses Claude Sonnet 4.5, which costs approximately $3 per million input tokens.



Step 2: Get Fathom API Key





Log in to your Fathom account



Navigate to Settings > API & Integrations



Click Generate API Key



Copy and save your API key securely



Step 3: Set Up Slack App





Go to https://api.slack.com/apps



Click Create New App > From scratch



Name your app (e.g., "Sales Call Analyzer")



Select your Slack workspace



Navigate to OAuth & Permissions



Under Scopes > Bot Token Scopes, add:





chat:write



chat:write.public



channels:read



users:read



Click Install App to Workspace



Copy the Bot User OAuth Token (starts with xoxb-)



Step 4: Create Google Sheet





Create a new Google Sheet for logging call data



Add the following column headers in Row 1:





Column A: Timestamp



Column B: Recording ID



Column C: Advisor Email



Column D: Session ID



Column E: Analysis Summary



Column F: Key Insights



Column G: Slack Thread ID



Note the Sheet ID from the URL (the long string after /d/)



Share the sheet with your n8n Google account email



Step 5: Create Configuration Sheet





Create another Google Sheet named "Sales AI Config" (or any name you prefer)



Add the following rows with exact labels in Column A:





Row 1: Fathom API



Row 2: Sales Analysis AI System Prompt



Row 3: Slack Messaging AI Agent Prompt



In Column B, add your values:





Row 1: Your Fathom API key



Row 2: Your custom AI prompt for sales analysis (see example below)



Row 3: Your custom AI prompt for Slack messaging (see example below)



Share this sheet with your n8n Google account


Sales Analysis Prompt (Row 2, Column B):
https://docs.google.com/spreadsheets/d/1eer0QGN9vTHdzdsbMblevS675uzqPICtGnx8JzamUXU/edit?usp=sharing

Part 2: Import Workflow into n8n

Step 6: Access Your n8n Instance





Open your n8n instance (cloud or self-hosted)



Log in to your account



Step 7: Import the JSON Workflow





In n8n, click the "+" button in the top-right corner



Select Import from File (or Import from URL)



Choose the Sales_Call_Analysis_Agent.json file you downloaded



Click Import



The workflow will appear on your canvas with all nodes



Part 3: Configure Workflow Credentials

Step 8: Set Up OpenRouter Credentials





Click on the "OpenRouter Chat Model" node



Under Credentials, click Create New Credential



Name it "OpenRouter account"



Paste your OpenRouter API key



Click Save



Repeat for "OpenRouter Chat Model2" node (select the same credential)



Step 9: Configure Slack Credentials





Click on the "Send the Headline to the Channel" node



Under Credentials, click Create New Credential



Choose OAuth2



Follow the OAuth flow to connect your Slack app



Grant the required permissions



Select the target Slack channel (e.g., #sales-coach)



Repeat for the "Reply with Analysis to the thread" node



Step 10: Configure Google Sheets Credentials





Click on the "Get row(s) in sheet" node



Under Credentials, click Create New Credential



Choose OAuth2



Follow the OAuth flow to connect your Google account



Grant permissions to access Google Sheets



In the node settings:





Document ID: Paste your Configuration Sheet ID



Sheet Name: Enter the exact sheet name (e.g., "logs/setup")



Range: Set to A:B (columns A and B)



Repeat configuration for the "Append row in sheet" node:





Document ID: Paste your Data Logging Sheet ID



Sheet Name: Enter the sheet name



Configure column mappings



Step 11: Update Slack Channel ID





In Slack, open the channel where you want posts to appear



Right-click the channel name > View channel details



At the bottom, you'll see the Channel ID (e.g., C0962S41ZDG)



Copy this ID



In n8n, update both Slack nodes:





"Send the Headline to the Channel": Update channelId value



"Reply with Analysis to the thread": Update channelId value



Step 12: Configure Error Notifications





Click on the "Send Error Message to Usama" node



Update the Slack User ID or Channel ID where errors should be sent



To find a Slack User ID:





Click on a user's profile in Slack



Click More > Copy member ID



Part 4: Testing & Activation

Step 13: Activate the Webhook





Click on the "Webhook" node at the start of the workflow



Click Copy Webhook URL (it will look like: https://your-n8n-instance.com/webhook/f342cc8e-668b-4cc0-9917-c4916c7a82aa)



Save this URL securely



Step 14: Configure Fathom Webhook





Log in to Fathom



Go to Settings > Integrations > Webhooks



Click Add Webhook



Paste your n8n webhook URL



Select trigger events:





✓ Recording completed



✓ Transcript available



Save the webhook



Step 15: Test the Workflow

Manual Test:





In n8n, click Execute Workflow button



Use the "Webhook" node's test functionality



Send a test payload:

json

{
  "recording_id": "12345",
  "advisor_email": "test@example.com",
  "contains_gameplan": true
}





Monitor each node to ensure proper execution



Check Slack for the posted message



Verify data appears in your Google Sheet

Live Test:





Record a test sales call in Fathom



Ensure the call title contains "GAMEPLAN" (if you want the workflow to process it)



Wait for the recording to finish processing



Check your Slack channel for the analysis



Review the Google Sheet for logged data



Step 16: Activate the Workflow





Toggle the Active switch in the top-right corner of n8n



The workflow status will change to "Active"



Your workflow is now live and will process incoming webhooks



Part 5: Customization (Optional)

Modify AI Prompts

To change how the AI analyzes calls:





Open your Google Sheets configuration file



Edit the prompts in Column B (Rows 2 and 3)



Save the changes



The workflow will automatically use updated prompts on the next run



Adjust Slack Message Format





Open the "Send the Headline to the Channel" node



Modify the Blocks UI field to customize message appearance



Use Slack's Block Kit Builder for designing



Filter by Keywords

The workflow currently filters for calls with "GAMEPLAN" in the title:





Click the "Check 'GAMEPLAN' keyword is in the title" node



Modify the condition logic to filter by different keywords or criteria



Troubleshooting

Common Issues

Issue: Webhook not receiving data





Verify the webhook URL is correctly configured in Fathom



Check that the workflow is Active in n8n



Review n8n execution logs for errors

Issue: OpenRouter API errors





Confirm you have sufficient credits in your OpenRouter account



Verify the API key is correctly entered



Check that Claude Sonnet 4.5 is available in your region

Issue: Slack messages not posting





Verify Slack OAuth credentials are valid



Confirm the bot has permissions to post in the target channel



Ensure the channel ID is correct

Issue: Google Sheets not updating





Check that the sheet is shared with your n8n Google account



Verify column mappings match your sheet structure



Confirm OAuth credentials are still valid

Issue: AI analysis timing out





Increase the timeout value in OpenRouter nodes (currently set to 360000ms)



Consider splitting very long transcripts into chunks



Monitoring & Maintenance

View Execution History





In n8n, go to Executions tab



Review past workflow runs



Click on any execution to see detailed logs



Check for errors or failed nodes



Update API Keys

When API keys expire:





Go to Credentials in n8n settings



Find the relevant credential



Edit and update the API key



Save changes



Workflow Optimization

Monitor costs and performance:





Track OpenRouter API usage and costs



Review execution times for bottlenecks



Optimize AI prompts for more focused responses



Adjust max tokens to control costs



Support & Resources





n8n Documentation: https://docs.n8n.io/



OpenRouter Docs: https://openrouter.ai/docs



Fathom API Docs: https://fathom.video/api-docs



Slack API Docs: https://api.slack.com/



Security Best Practices





Never share your API keys publicly



Use environment variables for sensitive data when possible



Regularly rotate API keys (quarterly recommended)



Restrict Slack bot permissions to only what's needed



Use Google Sheets permissions to limit access



Enable 2FA on all connected accounts



Monitor webhook activity for unusual patterns



Conclusion

Your Sales Call Analysis Agent is now set up and ready to automatically analyze sales calls, provide coaching insights, and keep your team informed via Slack.

The workflow will:





✓ Automatically trigger when Fathom recordings complete



✓ Fetch and process call transcripts



✓ Use AI to generate detailed analysis



✓ Post summaries to Slack



✓ Log all data to Google Sheets for tracking

For questions or issues, consult the troubleshooting section or reach out to your n8n administrator.

Happy analyzing! 🎯