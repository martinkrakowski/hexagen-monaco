# Using the AI Welcome Screen

The Welcome Screen allows you to instantly generate a complete project configuration by simply describing your desired architecture in natural language.

## Getting Started
1. Open the HexaGen Monaco interface.
2. Click the **"Generate from AI"** button on the main screen to open the Welcome Dialog.
3. You will see a text prompt where you can describe your project.

## Writing a Good Prompt
For the best results, include details about your domain, required infrastructure, and UI.

**Example Prompt:**
> "I want to build a real estate platform. It should have a core domain for Properties and Agents. Use NestJS for the API, Prisma for the database, and Next.js for the frontend."

## Reviewing and Customizing
Once the AI generates your configuration:
1. The wizard will automatically parse the configuration and populate the settings.
2. You will be placed at the first step that requires your attention, or directly on the Summary page if the AI provided a complete manifest.
3. Steps completed by the AI will be marked as read-only or pre-filled. You can always adjust these settings if needed.

## Handling Existing Work
If you are already editing a project and you trigger the Welcome Screen, the system will prompt you to either **Save** your current work or **Discard** it before applying the new AI-generated configuration.
