"use client";

import { ChatWidget } from "ucl-chat-widget/client";

export default function Home() {
  return (
    <ChatWidget
      config={{
        sidebarTitle: "AI Assist",
        apiBasePath: "/api",
        sidebarPanels: [
          {
            title: "Scenario",
            defaultExpanded: true,
            content: (
              <>
                <p>
                  You are assisting a professor in evaluating the outcome of an
                  anti-discrimination campaign across schools in the US conducted
                  for one year in the 2000.
                </p>
                <p className="mt-2">
                  You have access to the professor&apos;s data folder to complete
                  the analysis. Unfortunately, the professor let their kid play
                  with the folder, so it may contain{" "}
                  <strong>unnecessary files</strong>, and some data files may be{" "}
                  <strong>corrupted or unreliable</strong>.
                </p>
                <p className="mt-2">
                  You <strong>may use AI tools</strong> to support your work, but
                  you are responsible for verifying results, producing plots, and
                  clearly explaining your reasoning. You can also use excel,
                  python, web browser or any other tool, but you may not discuss
                  with anyone else. There are trick questions.
                </p>
              </>
            ),
          },
          {
            title: "Data description",
            content: (
              <p>
                You are assisting a professor in evaluating the outcome of an
                anti-discrimination campaign across schools in the US conducted
                for one year in the 2000.
              </p>
            ),
          },
          {
            title: "Tasks",
            content: (
              <p>
                You are assisting a professor in evaluating the outcome of an
                anti-discrimination campaign across schools in the US conducted
                for one year in the 2000.
              </p>
            ),
          },
        ],
      }}
    />
  );
}
